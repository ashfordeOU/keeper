import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The long-lived PowerShell is for Windows; where PowerShell 7 (pwsh) is
// installed, the same request/answer loop is checked here too.
const pwsh = process.env.KEEPER_TEST_PWSH ?? ['/usr/bin/pwsh', '/usr/local/bin/pwsh', '/opt/microsoft/powershell/7/pwsh'].find(existsSync);

describe.runIf(!!pwsh)('long-lived PowerShell', () => {
  it('answers many questions from one process, in order, with any text', async () => {
    const { psRun, setPsExe } = await import('../electron/services/ps-host');
    setPsExe(() => pwsh!);
    const t0 = Date.now();
    const first = await psRun("'hello ' + (1 + 2)", 30_000);
    expect(first).toEqual({ ok: true, stdout: expect.stringMatching(/^hello 3\s*$/) });
    const warm = Date.now();
    const many = await Promise.all(Array.from({ length: 20 }, (_, i) => psRun(`"n=${i} ü 中"`, 10_000)));
    many.forEach((r, i) => expect(r.stdout.trim()).toBe(`n=${i} ü 中`));
    // Twenty answers from a running PowerShell take less time than starting one.
    expect(Date.now() - warm).toBeLessThan(warm - t0 + 2000);
    // A script that fails still gets an (empty) answer and the host keeps working.
    expect((await psRun('throw "nope"', 10_000)).stdout.trim()).toBe('');
    expect((await psRun('function F { 41 + 1 }; F', 10_000)).stdout.trim()).toBe('42');
  }, 90_000);
});
