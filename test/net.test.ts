// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { bigToV6, inPrefix, procHexAddr, scopeOf, splitHostPort, v4ToInt, v6ToBig } from '../core/net/addr';
import { applyRates, byApp, byDestination, flowKey, flowsToCsv, ifaceTotals, newInternetApps, portName, rateBetween, serviceFor, type FlowRow } from '../core/net/flows';
import { asnValue, countryValue, csvFields, dbipUrls, flag, RangeTable, RangeTableBuilder } from '../core/net/geo';
import {
  parseAirport, parseBsdNetstatRoutes, parseGetDnsServers, parseGetNetTcp, parseGetVpnConnection, parseIpRouteGet, parseLsofF, parseNetshWlan, parseNetstatAno,
  parseNetstatE, parseNetstatIbn, parseNettop, parseNmcliConnections, parseNmcliWifi, parseProcNet, parseProcNetDev, parseProcRoute, parseProcRoute6,
  parseProcWireless, parseResolvConf, parseResolvectlDns, parseRouteGet, parseRoutePrint, parseScutilDns, parseScutilNcList, parseSs, parseWgDump, splitNmcli,
} from '../core/net/parse';
import { classifyIface, internetIface, killSwitchAdvice, lookupRoute, pathFor, trafficVerdict } from '../core/net/route';
import type { IfaceKind } from '../core/net/types';
import { isWgKey, parseOpenVpn, parseVpnConfig, parseWireGuard } from '../core/net/vpnconf';

describe('addresses', () => {
  it('parses and prints IPv4 and IPv6', () => {
    expect(v4ToInt('192.168.1.10')).toBe(0xc0a8010a);
    expect(v4ToInt('256.1.1.1')).toBeNull();
    expect(bigToV6(v6ToBig('2001:db8:0:0:0:0:0:1')!)).toBe('2001:db8::1');
    expect(bigToV6(v6ToBig('::')!)).toBe('::');
    expect(v6ToBig('::ffff:1.2.3.4')).toBe(0xffff01020304n);
    expect(v6ToBig('fe80::1%en0')).toBe(v6ToBig('fe80::1'));
    expect(v6ToBig('1:2:3')).toBeNull();
  });
  it('matches prefixes', () => {
    expect(inPrefix('10.8.0.5', '10.8.0.0', 24)).toBe(true);
    expect(inPrefix('10.8.1.5', '10.8.0.0', 24)).toBe(false);
    expect(inPrefix('8.8.8.8', '0.0.0.0', 0)).toBe(true);
    expect(inPrefix('2001:db8::5', '2001:db8::', 32)).toBe(true);
    expect(inPrefix('2001:db9::5', '2001:db8::', 32)).toBe(false);
  });
  it('knows local, LAN and internet addresses', () => {
    expect(scopeOf('127.0.0.1')).toBe('loopback');
    expect(scopeOf('::1')).toBe('loopback');
    expect(scopeOf('192.168.1.1')).toBe('lan');
    expect(scopeOf('172.20.0.1')).toBe('lan');
    expect(scopeOf('100.100.1.1')).toBe('lan');
    expect(scopeOf('169.254.3.3')).toBe('link');
    expect(scopeOf('fe80::1')).toBe('link');
    expect(scopeOf('fd12::1')).toBe('lan');
    expect(scopeOf('224.0.0.251')).toBe('multicast');
    expect(scopeOf('8.8.8.8')).toBe('internet');
    expect(scopeOf('::ffff:8.8.8.8')).toBe('internet');
    expect(scopeOf('2606:4700::1111')).toBe('internet');
  });
  it('reads /proc hex addresses', () => {
    expect(procHexAddr('0100007F:1F90')).toEqual({ ip: '127.0.0.1', port: 8080 });
    expect(procHexAddr('00000000000000000000000001000000:0016')).toEqual({ ip: '::1', port: 22 });
    // ::ffff:192.168.1.5 as stored by the kernel
    expect(procHexAddr('0000000000000000FFFF00000501A8C0:01BB')).toEqual({ ip: '192.168.1.5', port: 443 });
  });
  it('splits host and port in every style', () => {
    expect(splitHostPort('1.2.3.4:443')).toEqual({ host: '1.2.3.4', port: 443 });
    expect(splitHostPort('[2001:db8::1]:443')).toEqual({ host: '2001:db8::1', port: 443 });
    expect(splitHostPort('2001:db8::1.443')).toEqual({ host: '2001:db8::1', port: 443 });
    expect(splitHostPort('192.168.1.5.51234')).toEqual({ host: '192.168.1.5', port: 51234 });
    expect(splitHostPort('*:*')).toEqual({ host: '*' });
    expect(splitHostPort('fe80::1%en0.5353')).toEqual({ host: 'fe80::1%en0', port: 5353 });
  });
});

describe('Linux', () => {
  it('reads /proc/net/tcp and udp', () => {
    const tcp = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41234 1 0000000000000000 100 0 0 10 0
   1: 0501A8C0:D431 2E4AFA8E:01BB 01 00000000:00000000 02:000009F4 00000000  1000        0 51234 2 0000000000000000 20 4 30 10 -1`;
    const c = parseProcNet(tcp, 'TCP', 4);
    expect(c[0]).toMatchObject({ local: '127.0.0.1', localPort: 8080, state: 'Listen', uid: 1000, inode: '41234', remote: undefined });
    expect(c[1]).toMatchObject({ local: '192.168.1.5', localPort: 54321, remote: '142.250.74.46', remotePort: 443, state: 'Established' });
    const udp = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops
  1: 00000000:14E9 00000000:0000 07 00000000:00000000 00:00000000 00000000  1000        0 22222 2 0000000000000000 0`;
    expect(parseProcNet(udp, 'UDP', 4)[0]).toMatchObject({ proto: 'UDP', localPort: 5353, remote: undefined, state: undefined });
  });
  it('reads ss with owners and byte counts', () => {
    const out = `tcp   ESTAB  0      0      192.168.1.5:54321   142.250.74.46:443  users:(("browser",pid=1234,fd=88)) cubic wscale:7,7 rto:204 rtt:3.2/1.5 bytes_sent:2048 bytes_acked:2049 bytes_received:65536 segs_out:20
tcp   LISTEN 0      4096   127.0.0.53%lo:53    0.0.0.0:*          users:(("systemd-resolve",pid=600,fd=14))
udp   UNCONN 0      0      0.0.0.0:5353        0.0.0.0:*          users:(("avahi-daemon",pid=700,fd=12))
tcp   ESTAB  0      0      [::ffff:192.168.1.5]:40000 [::ffff:1.1.1.1]:853 users:(("resolved",pid=600,fd=20)) bytes_acked:10 bytes_received:20
u_str ESTAB  0      0      * 12345 * 12346`;
    const c = parseSs(out);
    expect(c).toHaveLength(4);
    expect(c[0]).toMatchObject({ pid: 1234, name: 'browser', remote: '142.250.74.46', remotePort: 443, bytesIn: 65536, bytesOut: 2049, state: 'Established' });
    expect(c[1]).toMatchObject({ local: '127.0.0.53', localPort: 53, state: 'Listen', remote: undefined });
    expect(c[2]).toMatchObject({ proto: 'UDP', localPort: 5353, state: undefined });
    expect(c[3]).toMatchObject({ local: '192.168.1.5', remote: '1.1.1.1', remotePort: 853, family: 4 });
  });
  it('reads the routing tables', () => {
    const r = parseProcRoute(`Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
wlan0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0
wlan0\t0001A8C0\t00000000\t0001\t0\t0\t600\t00FFFFFF\t0\t0\t0
wg0\t00000000\t00000000\t0001\t0\t0\t50\t00000080\t0\t0\t0
wg0\t00000080\t00000000\t0001\t0\t0\t50\t00000080\t0\t0\t0`);
    expect(r[0]).toEqual({ family: 4, iface: 'wlan0', dest: '0.0.0.0', prefix: 0, gateway: '192.168.1.1', metric: 600 });
    expect(r[1]).toMatchObject({ dest: '192.168.1.0', prefix: 24 });
    expect(lookupRoute(r, '8.8.8.8')?.iface).toBe('wg0'); // the two /1 halves beat the default route
    expect(lookupRoute(r, '192.168.1.7')?.iface).toBe('wlan0');
    const r6 = parseProcRoute6(`00000000000000000000000000000000 00 00000000000000000000000000000000 00 fe800000000000000000000000000001 00000400 00000001 00000000 00450003     wlan0
20010db8000000000000000000000000 40 00000000000000000000000000000000 00 00000000000000000000000000000000 00000100 00000001 00000000 00000001     wlan0`);
    expect(r6[0]).toMatchObject({ family: 6, dest: '::', prefix: 0, gateway: 'fe80::1', iface: 'wlan0', metric: 1024 });
    expect(r6[1]).toMatchObject({ dest: '2001:db8::', prefix: 64 });
    expect(parseIpRouteGet('1.1.1.1 via 192.168.1.1 dev wlan0 src 192.168.1.5 uid 1000 \n    cache')).toEqual({ iface: 'wlan0', gateway: '192.168.1.1', src: '192.168.1.5' });
    expect(parseIpRouteGet('8.8.8.8 dev wg0 table 51820 src 10.2.0.2 uid 1000')).toMatchObject({ iface: 'wg0', gateway: undefined });
  });
  it('reads interface bytes, Wi-Fi and DNS', () => {
    const dev = parseProcNetDev(`Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000  10    0    0    0     0          0         0 1000  10    0    0    0     0       0          0
 wlan0: 5000000 4000 0 0 0 0 0 0 700000 3000 0 0 0 0 0 0`);
    expect(dev.get('wlan0')).toEqual({ rx: 5000000, tx: 700000 });
    expect(parseProcWireless(`Inter-| sta-|   Quality        |   Discarded packets               | Missed | WE
 face | tus | link level noise |  nwid  crypt   frag  retry   misc | beacon | 22
 wlan0: 0000   58.  -52.  -256        0      0      0      0     12        0`).get('wlan0')).toEqual({ quality: 58, level: -52 });
    expect(parseNmcliWifi('no:Neighbour:40:6:130 Mbit/s:WPA2\nyes:Home\\:5G:78:36:540 Mbit/s:WPA3')).toEqual({ ssid: 'Home:5G', signal: 78, channel: '36', rate: '540 Mbit/s', security: 'WPA3' });
    expect(parseResolvConf('# managed\nnameserver 127.0.0.53\nnameserver fe80::1%wlan0\noptions edns0')).toEqual([{ address: '127.0.0.53' }, { address: 'fe80::1' }]);
    expect(parseResolvectlDns('Global:\nLink 2 (wlan0): 192.168.1.1\nLink 5 (wg0): 10.2.0.1 1.1.1.1#cloudflare-dns.com')).toEqual([
      { address: '192.168.1.1', iface: 'wlan0' }, { address: '10.2.0.1', iface: 'wg0' }, { address: '1.1.1.1', iface: 'wg0' },
    ]);
  });
  it('reads NetworkManager VPNs and wg show', () => {
    expect(splitNmcli('Work\\: Office:abc:vpn:tun0:activated')).toEqual(['Work: Office', 'abc', 'vpn', 'tun0', 'activated']);
    const v = parseNmcliConnections('Home Wi-Fi:1111:802-11-wireless:wlan0:activated\nWork:2222:vpn:tun0:activated\nHomeLab:3333:wireguard:::\nBack:4444:wireguard:wg1:activating');
    expect(v.map((x) => [x.name, x.type, x.state, x.iface])).toEqual([['Work', 'vpn', 'connected', 'tun0'], ['HomeLab', 'wireguard', 'disconnected', undefined], ['Back', 'wireguard', 'connecting', 'wg1']]);
    const wg = parseWgDump('wg0\tPRIVATEKEYSHOULDNOTBEKEPT=\tpubAAA=\t51820\toff\nwg0\tpeerBBB=\t(none)\t203.0.113.5:51820\t0.0.0.0/0,::/0\t1793400000\t123456\t65432\t25');
    expect(JSON.stringify([...wg])).not.toContain('PRIVATEKEY');
    expect(wg.get('wg0')!.peers[0]).toEqual({ publicKey: 'peerBBB=', endpoint: '203.0.113.5:51820', allowedIps: ['0.0.0.0/0', '::/0'], handshake: 1793400000000, rx: 123456, tx: 65432 });
  });
});

describe('macOS', () => {
  it('reads lsof field output', () => {
    const out = 'p512\ncBrowser Helper\nf31\ntIPv4\nPTCP\nn192.168.1.20:51234->17.57.144.20:443\nTST=ESTABLISHED\nf40\ntIPv6\nPUDP\nn*:5353\np900\ncKeeper\nf12\ntIPv4\nPTCP\nn127.0.0.1:7000\nTST=LISTEN\n';
    const c = parseLsofF(out);
    expect(c).toHaveLength(3);
    expect(c[0]).toMatchObject({ pid: 512, name: 'Browser Helper', remote: '17.57.144.20', remotePort: 443, state: 'Established', local: '192.168.1.20' });
    expect(c[1]).toMatchObject({ proto: 'UDP', local: '::', localPort: 5353, family: 6, remote: undefined });
    expect(c[2]).toMatchObject({ pid: 900, state: 'Listen', localPort: 7000 });
  });
  it('reads nettop per process and per connection, with the interface', () => {
    const out = `time,,interface,state,bytes_in,bytes_out,
14:22:01.123456,Mail.620,,,123456,7890,
14:22:01.123456,tcp4 192.168.1.20:51234<->17.57.144.20:993,en0,Established,123000,7800,
14:22:01.123456,tcp6 2001:db8::5.51235<->2606:4700::1111.443,utun4,Established,456,90,
14:22:01.123456,mDNSResponder.212,,,500,600,
14:22:01.123456,udp4 *:5353<->*:*,en0,,500,600,`;
    const { conns, procs } = parseNettop(out);
    expect(procs).toEqual([{ pid: 620, name: 'Mail', bytesIn: 123456, bytesOut: 7890 }, { pid: 212, name: 'mDNSResponder', bytesIn: 500, bytesOut: 600 }]);
    expect(conns[0]).toMatchObject({ pid: 620, remote: '17.57.144.20', remotePort: 993, iface: 'en0', bytesIn: 123000, state: 'Established' });
    expect(conns[1]).toMatchObject({ family: 6, remote: '2606:4700::1111', remotePort: 443, iface: 'utun4' });
    expect(conns[2]).toMatchObject({ proto: 'UDP', pid: 212, localPort: 5353, remote: undefined, local: '0.0.0.0' });
  });
  it('reads netstat -rn, skipping interface-scoped routes', () => {
    const out = `Routing tables

Internet:
Destination        Gateway            Flags               Netif Expire
default            192.168.1.1        UGScg                 en0
default            link#22            UCSIg               utun4
0/1                10.8.0.1           UGSc                utun4
10.8.0/24          10.8.0.1           UGSc                utun4
127                127.0.0.1          UCS                   lo0
128.0/1            10.8.0.1           UGSc                utun4
192.168.1          link#6             UCS                   en0      !
192.168.1.1/32     link#6             UCS                   en0      !
192.168.1.1        a4:5e:60:11:22:33  UHLWIir               en0   1171

Internet6:
Destination                             Gateway                                 Flags               Netif Expire
default                                 fe80::%utun0                            UGcIg               utun0
default                                 fe80::1%en0                             UGc                   en0
::1                                     ::1                                     UHL                   lo0`;
    const r = parseBsdNetstatRoutes(out);
    expect(r.find((x) => x.iface === 'utun4' && x.prefix === 0)).toBeUndefined();
    expect(r.find((x) => x.dest === '10.8.0.0')).toMatchObject({ prefix: 24, iface: 'utun4' });
    expect(r.find((x) => x.dest === '127.0.0.0')).toMatchObject({ prefix: 8 });
    expect(lookupRoute(r, '8.8.8.8')?.iface).toBe('utun4');
    expect(lookupRoute(r, '192.168.1.40')?.iface).toBe('en0');
    expect(lookupRoute(r, '2606:4700::1111')).toMatchObject({ iface: 'en0', gateway: 'fe80::1' });
    expect(parseRouteGet('   route to: 8.8.8.8\ndestination: default\n       mask: default\n    gateway: 192.168.1.1\n  interface: en0\n      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING>')).toEqual({ iface: 'en0', gateway: '192.168.1.1' });
  });
  it('reads netstat -ibn, scutil VPNs and DNS, and Wi-Fi', () => {
    const ib = parseNetstatIbn(`Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                        10000     0    2000000    10000     0    2000000     0
en0        1500  <Link#6>    a4:5e:60:11:22:33  900000     0  800000000   500000     0   60000000     0
en0        1500  192.168.1     192.168.1.20     800000     -  700000000   400000     -   50000000     -
utun4      1380  <Link#22>                       30000     0    9000000    20000     0    1000000     0`);
    expect(ib.get('en0')).toEqual({ rx: 800000000, tx: 60000000 });
    expect(ib.get('utun4')).toEqual({ rx: 9000000, tx: 1000000 });
    const nc = parseScutilNcList(`Available network connection services in the current set (*=enabled):
* (Connected)      0B6F8A1B-1111-2222-3333-444455556666 PPP --> L2TP      "Office L2TP"                    [PPP:L2TP]
* (Disconnected)   1234ABCD-1111-2222-3333-444455556666 IPSec             "Lab IPSec"                      [IPSec]
* (Connected)      5678ABCD-1111-2222-3333-444455556666 VPN (com.wireguard.macos) "home"                 [VPN:com.wireguard.macos]`);
    expect(nc.map((v) => [v.name, v.type, v.state])).toEqual([['Office L2TP', 'l2tp', 'connected'], ['Lab IPSec', 'ipsec', 'disconnected'], ['home', 'wireguard', 'connected']]);
    const dns = parseScutilDns(`DNS configuration

resolver #1
  search domain[0] : lan
  nameserver[0] : 10.2.0.1
  if_index : 22 (utun4)
  flags    : Request A records
  reach    : 0x00000003 (Reachable,Transient Connection)

resolver #2
  domain   : local
  options  : mdns
  timeout  : 5

resolver #3
  domain   : corp.example
  nameserver[0] : 10.0.0.53
  if_index : 22 (utun4)`);
    expect(dns).toEqual([{ address: '10.2.0.1', iface: 'utun4', domain: undefined }, { address: '10.0.0.53', iface: 'utun4', domain: 'corp.example' }]);
    expect(parseAirport(`Wi-Fi:
      Interfaces:
        en0:
          Current Network Information:
            Home 5G:
              PHY Mode: 802.11ax
              Channel: 36 (5GHz, 80MHz)
              Security: WPA2/WPA3 Personal
              Signal / Noise: -52 dBm / -92 dBm
              Transmit Rate: 864`)).toEqual({ ssid: 'Home 5G', channel: '36 (5GHz, 80MHz)', security: 'WPA2/WPA3 Personal', rate: '864 Mb/s', signalDbm: -52 });
  });
});

describe('Windows', () => {
  it('reads netstat -ano', () => {
    const c = parseNetstatAno(`
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012
  TCP    192.168.1.5:50432      52.1.2.3:443           ESTABLISHED     4567
  TCP    [::]:445               [::]:0                 LISTENING       4
  TCP    [2001:db8::5]:50500    [2606:4700::1111]:443  ESTABLISHED     4567
  UDP    0.0.0.0:5353           *:*                                    2345`);
    expect(c).toHaveLength(5);
    expect(c[0]).toMatchObject({ state: 'Listen', pid: 1012, remote: undefined });
    expect(c[1]).toMatchObject({ remote: '52.1.2.3', remotePort: 443, pid: 4567, state: 'Established' });
    expect(c[3]).toMatchObject({ family: 6, remote: '2606:4700::1111' });
    expect(c[4]).toMatchObject({ proto: 'UDP', pid: 2345, remote: undefined });
  });
  it('reads Get-NetTCPConnection JSON with numeric states', () => {
    const c = parseGetNetTcp(JSON.stringify([{ LocalAddress: '192.168.1.5', LocalPort: 50432, RemoteAddress: '52.1.2.3', RemotePort: 443, State: 5, OwningProcess: 4567 }, { LocalAddress: '::', LocalPort: 445, RemoteAddress: '::', RemotePort: 0, State: 'Listen', OwningProcess: 4 }]));
    expect(c[0]).toMatchObject({ state: 'Established', pid: 4567, remote: '52.1.2.3' });
    expect(c[1]).toMatchObject({ state: 'Listen', remote: undefined, family: 6 });
    expect(parseGetNetTcp('{"LocalAddress":"1.2.3.4","LocalPort":1,"RemoteAddress":"5.6.7.8","RemotePort":2,"State":11,"OwningProcess":0}')[0].state).toBe('TimeWait');
  });
  it('reads route print, both tables and the interface list', () => {
    const { routes, ifaces } = parseRoutePrint(`===========================================================================
Interface List
 16...a4 5e 60 11 22 33 ......Intel(R) Wi-Fi 6 AX201 160MHz
 23...........................WireGuard Tunnel
  1...........................Software Loopback Interface 1
===========================================================================

IPv4 Route Table
===========================================================================
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0      192.168.1.1     192.168.1.5     35
          0.0.0.0        128.0.0.0         On-link        10.2.0.2      5
        128.0.0.0        128.0.0.0         On-link        10.2.0.2      5
      192.168.1.0    255.255.255.0         On-link       192.168.1.5    291
===========================================================================
Persistent Routes:
  None

IPv6 Route Table
===========================================================================
Active Routes:
 If Metric Network Destination      Gateway
 16    291 ::/0                     fe80::1
 23      5 ::/1                     On-link
  1    331 ::1/128                  On-link
 16    291 2001:db8:aaaa:bbbb:cccc:dddd:eeee:ffff/128
                                    On-link
===========================================================================`);
    expect(ifaces.get(23)).toBe('WireGuard Tunnel');
    expect(ifaces.get(16)).toMatch(/Wi-Fi 6/);
    expect(lookupRoute(routes, '8.8.8.8')).toMatchObject({ iface: '10.2.0.2', prefix: 1 });
    expect(lookupRoute(routes, '192.168.1.9')).toMatchObject({ iface: '192.168.1.5' });
    expect(routes.find((r) => r.dest === '2001:db8:aaaa:bbbb:cccc:dddd:eeee:ffff')).toMatchObject({ prefix: 128, iface: '#16', gateway: undefined });
    expect(lookupRoute(routes, '2606:4700::1111')).toMatchObject({ iface: '#23' });
  });
  it('reads VPN connections, DNS, Wi-Fi and totals', () => {
    const v = parseGetVpnConnection(JSON.stringify([{ Name: 'Office', ServerAddress: 'vpn.example.com', TunnelType: 3, ConnectionStatus: 'Connected', Guid: '{abc}' }]));
    expect(v[0]).toMatchObject({ name: 'Office', type: 'ikev2', state: 'connected', server: 'vpn.example.com', id: '{abc}' });
    expect(parseGetVpnConnection('{"Name":"Lab","TunnelType":"L2tp","ConnectionStatus":"Disconnected"}')[0]).toMatchObject({ type: 'l2tp', state: 'disconnected' });
    expect(parseGetDnsServers(JSON.stringify([{ InterfaceAlias: 'Wi-Fi', AddressFamily: 2, ServerAddresses: ['192.168.1.1'] }, { InterfaceAlias: 'wg0', AddressFamily: 2, ServerAddresses: ['10.2.0.1'] }, { InterfaceAlias: 'X', ServerAddresses: [] }])))
      .toEqual([{ address: '192.168.1.1', iface: 'Wi-Fi' }, { address: '10.2.0.1', iface: 'wg0' }]);
    expect(parseNetshWlan(`There is 1 interface on the system:

    Name                   : Wi-Fi
    State                  : connected
    SSID                   : Home 5G
    BSSID                  : a4:5e:60:11:22:33
    Authentication         : WPA2-Personal
    Channel                : 36
    Receive rate (Mbps)    : 866.7
    Signal                 : 92%`)).toEqual({ ssid: 'Home 5G', signal: 92, channel: '36', rate: '866.7 Mb/s', security: 'WPA2-Personal' });
    expect(parseNetstatE('Interface Statistics\n\n                           Received            Sent\n\nBytes                    1234567890        98765432\nUnicast packets')).toEqual({ rx: 1234567890, tx: 98765432 });
  });
});

describe('routes and VPN verdicts', () => {
  const kinds = new Map<string, IfaceKind>([['wlan0', 'wifi'], ['wg0', 'vpn'], ['lo', 'loopback']]);
  const full = [
    { family: 4 as const, dest: '0.0.0.0', prefix: 0, gateway: '192.168.1.1', iface: 'wlan0', metric: 600 },
    { family: 4 as const, dest: '0.0.0.0', prefix: 1, iface: 'wg0', metric: 50 },
    { family: 4 as const, dest: '128.0.0.0', prefix: 1, iface: 'wg0', metric: 50 },
    { family: 4 as const, dest: '192.168.1.0', prefix: 24, iface: 'wlan0', metric: 600 },
    { family: 6 as const, dest: '::', prefix: 0, gateway: 'fe80::1', iface: 'wlan0', metric: 1024 },
  ];
  it('classifies interfaces', () => {
    expect(classifyIface('wg0')).toBe('vpn');
    expect(classifyIface('tun0')).toBe('vpn');
    expect(classifyIface('utun4', { platform: 'darwin' })).toBe('tunnel');
    expect(classifyIface('utun4', { platform: 'darwin', vpnIfaces: new Set(['utun4']) })).toBe('vpn');
    expect(classifyIface('wlp2s0')).toBe('wifi');
    expect(classifyIface('en0', { wifi: new Set(['en0']) })).toBe('wifi');
    expect(classifyIface('enp3s0')).toBe('ethernet');
    expect(classifyIface('docker0')).toBe('virtual');
    expect(classifyIface('lo')).toBe('loopback');
    expect(classifyIface('Local Area Connection 2', { description: 'WireGuard Tunnel' })).toBe('vpn');
    expect(classifyIface('Ethernet 3', { description: 'TAP-Windows Adapter V9' })).toBe('vpn');
    expect(classifyIface('Wi-Fi', { description: 'Intel(R) Wi-Fi 6 AX201 160MHz' })).toBe('wifi');
  });
  it('finds the path of each connection', () => {
    expect(pathFor('8.8.8.8', full, kinds)).toMatchObject({ path: 'vpn', iface: 'wg0' });
    expect(pathFor('192.168.1.40', full, kinds)).toMatchObject({ path: 'lan', iface: 'wlan0' });
    expect(pathFor('127.0.0.1', full, kinds).path).toBe('local');
    expect(pathFor('2606:4700::1111', full, kinds)).toMatchObject({ path: 'direct', iface: 'wlan0' });
    expect(pathFor('8.8.8.8', full, kinds, 'wlan0').path).toBe('direct');
    expect(pathFor('192.168.1.5', full, kinds, 'lo')).toMatchObject({ path: 'local', iface: 'lo' }); // own address
    expect(internetIface(full, 4)).toBe('wg0');
  });
  it('explains leaks in plain words', () => {
    const v = trafficVerdict(full, kinds, [{ id: 'x', name: 'Home', type: 'wireguard', state: 'connected', source: 'networkmanager', iface: 'wg0' }], [{ address: '192.168.1.1', iface: 'wlan0' }, { address: '10.2.0.1', iface: 'wg0' }, { address: '10.0.0.53', domain: 'corp' }]);
    expect(v).toMatchObject({ vpnUp: true, allV4: true, allV6: false, v6Leak: true, dnsOutside: ['192.168.1.1'] });
    expect(v.summary).toMatch(/IPv6 traffic can still leave through wlan0/);
    expect(v.summary).toMatch(/DNS questions go to 192\.168\.1\.1/);
    const off = trafficVerdict(full.filter((r) => r.iface !== 'wg0'), new Map([['wlan0', 'wifi']]), [], []);
    expect(off).toMatchObject({ vpnUp: false, allV4: false, v6Leak: false });
    expect(off.summary).toMatch(/No VPN/);
    const split = trafficVerdict([full[0], { family: 4, dest: '10.0.0.0', prefix: 8, iface: 'wg0', metric: 50 }], kinds, [{ id: 'y', name: 'Work', type: 'vpn', state: 'connected', source: 'nm' }], []);
    expect(split.summary).toMatch(/split tunnel/);
    expect(killSwitchAdvice('linux').length).toBeGreaterThan(1);
  });
});

describe('VPN files', () => {
  const key = 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=';
  const pub = 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=';
  it('checks WireGuard keys', () => {
    expect(isWgKey(key)).toBe(true);
    expect(isWgKey('short=')).toBe(false);
  });
  it('reads and redacts a WireGuard config, warning about IPv6 and DNS', () => {
    const s = parseWireGuard(`[Interface]\nPrivateKey = ${key}\nAddress = 10.2.0.2/32\n\n[Peer]\nPublicKey = ${pub}\nPresharedKey = ${key}\nAllowedIPs = 0.0.0.0/0\nEndpoint = vpn.example.com:51820\n`, 'home.conf');
    expect(s.redacted).not.toContain(key);
    expect(s.redacted).toContain(pub);
    expect(s.redacted).toMatch(/PrivateKey = \(hidden\)/);
    expect(s).toMatchObject({ name: 'home', fullTunnel: true, coversV6: false, servers: ['vpn.example.com:51820'], addresses: ['10.2.0.2/32'] });
    expect(s.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(s.issues.map((i) => i.text).join(' ')).toMatch(/IPv6/);
    expect(s.issues.map((i) => i.text).join(' ')).toMatch(/DNS/);
  });
  it('finds mistakes in a broken WireGuard file', () => {
    const s = parseWireGuard('[Interface]\nPrivateKey = nope\n[Peer]\nPublicKey = also-nope\nAllowedIPs = 10.0.0.0/33\nEndpoint = host-without-port', 'x.conf');
    const errs = s.issues.filter((i) => i.level === 'error').map((i) => i.text).join('\n');
    expect(errs).toMatch(/PrivateKey/);
    expect(errs).toMatch(/PublicKey/);
    expect(errs).toMatch(/10\.0\.0\.0\/33/);
    expect(errs).toMatch(/host:port/);
    expect(errs).toMatch(/no Address/);
  });
  it('reads and redacts an OpenVPN profile', () => {
    const s = parseOpenVpn(`client\ndev tun\nproto udp\nremote vpn.example.com 1194\nremote vpn2.example.com 443 tcp\nredirect-gateway def1\ncipher BF-CBC\nauth-user-pass\n<ca>\n-----BEGIN CERTIFICATE-----\nMIIBpublic\n-----END CERTIFICATE-----\n</ca>\n<key>\n-----BEGIN PRIVATE KEY-----\nSECRETKEYDATA\n-----END PRIVATE KEY-----\n</key>\n<tls-crypt>\nSECRETTLS\n</tls-crypt>\n`, 'office.ovpn');
    expect(s.redacted).not.toContain('SECRETKEYDATA');
    expect(s.redacted).not.toContain('SECRETTLS');
    expect(s.redacted).toContain('MIIBpublic');
    expect(s).toMatchObject({ kind: 'openvpn', name: 'office', servers: ['vpn.example.com:1194/udp', 'vpn2.example.com:443/tcp'], fullTunnel: true, coversV6: false, needsLogin: true });
    const txt = s.issues.map((i) => i.text).join(' ');
    expect(txt).toMatch(/BF-CBC/);
    expect(txt).toMatch(/IPv6/);
    expect(parseVpnConfig('[Interface]\nPrivateKey = x', 'a.txt').kind).toBe('wireguard');
    expect(parseVpnConfig('hello', 'notes.txt').issues[0].level).toBe('error');
  });
});

describe('flows', () => {
  const mk = (o: Partial<FlowRow>): FlowRow => ({ key: '', proto: 'TCP', family: 4, local: '192.168.1.5', localPort: 1, app: 'App', scope: 'internet', path: 'direct', firstSeen: 0, ...o });
  it('computes rates and keeps first-seen times', () => {
    const a = [mk({ key: 'k', bytesIn: 1000, bytesOut: 100 })];
    const m1 = applyRates(a, new Map(), 1000);
    const b = [mk({ key: 'k', bytesIn: 3000, bytesOut: 600, firstSeen: 1000 })];
    applyRates(b, m1, 2000);
    expect(b[0]).toMatchObject({ rateIn: 2000, rateOut: 500, firstSeen: 0 });
    expect(rateBetween(500, 100, 1000)).toBe(100); // counter reset
    expect(rateBetween(undefined, 100, 1000)).toBeUndefined();
    expect(flowKey({ proto: 'TCP', local: 'a', localPort: 1, remote: 'b', remotePort: 2, pid: 3 })).toBe('TCP|a:1|b:2|3');
  });
  it('groups by app and by destination', () => {
    const flows = [
      mk({ key: '1', app: 'Browser', pid: 1, remote: '8.8.8.8', remotePort: 443, rateIn: 100, bytesIn: 1000, country: 'US', path: 'vpn' }),
      mk({ key: '2', app: 'Browser', pid: 2, remote: '8.8.8.8', remotePort: 80, rateIn: 50, bytesIn: 500, country: 'US', path: 'vpn' }),
      mk({ key: '3', app: 'Browser', pid: 1, remote: '1.1.1.1', remotePort: 443, rateOut: 10, path: 'direct' }),
      mk({ key: '4', app: 'Daemon', pid: 9, scope: 'listening', localPort: 22 }),
      mk({ key: '5', app: 'Printer', pid: 10, remote: '192.168.1.9', scope: 'lan', path: 'lan' }),
    ];
    const apps = byApp(flows);
    expect(apps[0]).toMatchObject({ app: 'Browser', pids: [1, 2], conns: 3, dests: 2, rateIn: 150, rateOut: 10, bytesIn: 1500, internet: true, countries: ['US'] });
    expect(apps[0].paths.sort()).toEqual(['direct', 'vpn']);
    expect(apps.find((a) => a.app === 'Daemon')).toMatchObject({ listening: 1, conns: 0, internet: false });
    expect(apps.find((a) => a.app === 'Printer')!.internet).toBe(false);
    const dests = byDestination(flows);
    expect(dests[0]).toMatchObject({ remote: '8.8.8.8', apps: ['Browser'], ports: [443, 80], conns: 2, rateIn: 150 });
    expect(newInternetApps(apps, new Set(['Daemon']))).toEqual(['Browser']);
    expect(ifaceTotals([
      { name: 'wlan0', kind: 'wifi', addresses: [], up: true, rxRate: 1000, txRate: 200 },
      { name: 'wg0', kind: 'vpn', addresses: [], up: true, rxRate: 900, txRate: 150 },
      { name: 'lo', kind: 'loopback', addresses: [], up: true, rxRate: 5000, txRate: 5000 },
    ])).toEqual({ rateIn: 1000, rateOut: 200, vpnIn: 900, vpnOut: 150, otherIn: 1000, otherOut: 200 });
  });
  it('names services and ports', () => {
    expect(serviceFor('lhr48s27-in-f14.1e100.net')).toBe('Google');
    expect(serviceFor('server-13-224-1-1.fra56.r.cloudfront.net.')).toBe('Amazon CloudFront');
    expect(serviceFor(undefined, 'AS13335 Cloudflare, Inc.')).toBe('Cloudflare, Inc.');
    expect(serviceFor('unknown.example')).toBeUndefined();
    expect(portName(443)).toBe('web (HTTPS)');
    expect(portName(443, 'UDP')).toBe('web (QUIC)');
    expect(portName(51820)).toMatch(/WireGuard/);
  });
  it('exports CSV safely', () => {
    const csv = flowsToCsv([mk({ key: '1', app: '=HYPERLINK("x")', host: 'a,b', remote: '8.8.8.8', remotePort: 443, rateIn: 12.6 })]);
    const [head, row] = csv.trim().split('\n');
    expect(head.split(',')[0]).toBe('app');
    expect(row.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
    expect(row).toContain('"a,b"');
    expect(row.endsWith(',13,')).toBe(true);
  });
});

describe('countries and networks', () => {
  const build = () => {
    const b = new RangeTableBuilder(countryValue);
    for (const l of ['1.0.0.0,1.0.0.255,AU', '1.0.1.0,1.0.3.255,CN', '0.0.0.0,0.255.255.255,ZZ', '2001:200::,2001:200:ffff:ffff:ffff:ffff:ffff:ffff,JP', '8.8.8.0,8.8.8.255,US', '2a00:1450::,2a00:1450:ffff:ffff:ffff:ffff:ffff:ffff,IE']) b.add(l);
    return b.build();
  };
  it('looks addresses up by halving', () => {
    const t = build();
    expect(t.lookup('1.0.0.7')).toBe('AU');
    expect(t.lookup('1.0.2.200')).toBe('CN');
    expect(t.lookup('1.0.4.1')).toBeUndefined();
    expect(t.lookup('8.8.8.8')).toBe('US');
    expect(t.lookup('0.1.2.3')).toBeUndefined(); // ZZ is dropped
    expect(t.lookup('2001:200::1')).toBe('JP');
    expect(t.lookup('2a00:1450:4001::5')).toBe('IE');
    expect(t.lookup('2a01::1')).toBeUndefined();
    expect(t.lookup('not an ip')).toBeUndefined();
  });
  it('survives saving and loading', () => {
    const buf = build().serialize({ date: '2026-10' });
    const { table, meta } = RangeTable.deserialize(buf);
    expect(meta.date).toBe('2026-10');
    expect(table.lookup('1.0.2.1')).toBe('CN');
    expect(table.lookup('2a00:1450::9')).toBe('IE');
    expect(table.size).toBe(5);
    expect(() => RangeTable.deserialize(Buffer.from('nope'))).toThrow();
  });
  it('merges neighbouring ranges with the same value', () => {
    const b = new RangeTableBuilder(countryValue);
    for (const l of ['5.0.0.0,5.0.0.255,FR', '5.0.1.0,5.0.1.255,FR', '5.0.2.0,5.0.2.255,DE', '2001:db8::,2001:db8::ff,FR', '2001:db8::100,2001:db8::1ff,FR']) b.add(l);
    const t = b.build();
    expect(t.size).toBe(3);
    expect(t.lookup('5.0.1.200')).toBe('FR');
    expect(t.lookup('5.0.2.1')).toBe('DE');
    expect(t.lookup('2001:db8::1a0')).toBe('FR');
  });
  it('reads ASN lines with quoted names', () => {
    expect(csvFields('1.0.0.0,1.0.0.255,13335,"Cloudflare, Inc."')).toEqual(['1.0.0.0', '1.0.0.255', '13335', 'Cloudflare, Inc.']);
    const b = new RangeTableBuilder(asnValue);
    b.add('1.0.0.0,1.0.0.255,13335,"Cloudflare, Inc."');
    expect(b.build().lookup('1.0.0.1')).toBe('AS13335 Cloudflare, Inc.');
  });
  it('makes flags and download addresses', () => {
    expect(flag('DE')).toBe('🇩🇪');
    expect(flag('zz')).toBe('');
    expect(dbipUrls('country', new Date(Date.UTC(2026, 0, 15)))).toEqual([
      'https://download.db-ip.com/free/dbip-country-lite-2026-01.csv.gz',
      'https://download.db-ip.com/free/dbip-country-lite-2025-12.csv.gz',
      'https://download.db-ip.com/free/dbip-country-lite-2025-11.csv.gz',
    ]);
  });
});
