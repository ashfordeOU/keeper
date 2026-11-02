// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// memory.stats: the kernel's memory counters, the ones Activity Monitor uses,
// without starting vm_stat every few seconds. Answers bytes; Keeper works out
// App Memory, Cached Files and Memory Used from them (core/memory.ts).
//   total          hw.memsize
//   free           free pages
//   internal       anonymous pages (App Memory once purgeable is taken off)
//   external       file-backed pages (Cached Files with purgeable)
//   purgeable, wired, compressed (pages the compressor occupies)
//   swapTotal, swapUsed   vm.swapusage
//   pressureLevel  kern.memorystatus_vm_pressure_level: 1 normal, 2 warning, 4 critical

import Foundation
import Darwin

/// One send right to the host port for the life of the helper (mach_host_self adds a reference each call).
private let memoryHost: mach_port_t = mach_host_self()

func memoryStats() -> [String: Any] {
    var out: [String: Any] = ["total": Double(ProcessInfo.processInfo.physicalMemory)]

    var pageSize: vm_size_t = 0
    if host_page_size(memoryHost, &pageSize) != KERN_SUCCESS || pageSize == 0 {
        pageSize = vm_size_t(vm_page_size)
    }
    let page = Double(pageSize)

    var vm = vm_statistics64()
    // HOST_VM_INFO64_COUNT is a C macro Swift does not import: the size in integer_t units.
    var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64_data_t>.stride / MemoryLayout<integer_t>.stride)
    let kr: kern_return_t = withUnsafeMutablePointer(to: &vm) { ptr in
        ptr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { ints in
            host_statistics64(memoryHost, HOST_VM_INFO64, ints, &count)
        }
    }
    if kr == KERN_SUCCESS {
        out["pageSize"] = page
        out["free"] = Double(vm.free_count) * page
        out["internal"] = Double(vm.internal_page_count) * page
        out["external"] = Double(vm.external_page_count) * page
        out["purgeable"] = Double(vm.purgeable_count) * page
        out["wired"] = Double(vm.wire_count) * page
        out["compressed"] = Double(vm.compressor_page_count) * page
    }

    var swap = xsw_usage()
    var swapSize = MemoryLayout<xsw_usage>.size
    if sysctlbyname("vm.swapusage", &swap, &swapSize, nil, 0) == 0 {
        out["swapTotal"] = Double(swap.xsu_total)
        out["swapUsed"] = Double(swap.xsu_used)
    }

    var level: Int32 = 0
    var levelSize = MemoryLayout<Int32>.size
    if sysctlbyname("kern.memorystatus_vm_pressure_level", &level, &levelSize, nil, 0) == 0 {
        out["pressureLevel"] = Int(level)
    }
    return out
}
