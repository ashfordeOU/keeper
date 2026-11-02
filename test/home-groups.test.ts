// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { groupRecent, projectOf } from '../core/home-groups';

const H = '/Users/ana';
const ctx = { home: H, roots: [`${H}/Documents`, `${H}/Downloads`, `${H}/Desktop`, '/mnt/data/work'] };
const f = (path: string, mtime: number) => ({ path, mtime });

describe('the project a recent file belongs to', () => {
  it('finds a repository root above src, packages, docs…', () => {
    expect(projectOf(`${H}/Developer/keeper/src/screens/Home.tsx`, ctx)).toEqual({ dir: `${H}/Developer/keeper`, name: 'keeper', kind: 'project' });
    expect(projectOf(`${H}/Documents/Work/Clients/Acme/site/src/index.ts`, ctx)).toMatchObject({ dir: `${H}/Documents/Work/Clients/Acme/site`, name: 'site' });
    // A monorepo: the first marker wins, so its packages are one project.
    expect(projectOf(`${H}/code/mono/packages/ui/src/Button.tsx`, ctx).dir).toBe(`${H}/code/mono`);
    // ~/src is a folder of projects, not a project's src.
    expect(projectOf(`${H}/src/tool/lib/x.go`, ctx).dir).toBe(`${H}/src/tool`);
  });
  it('takes the top-level folder under Documents, Desktop, Developer (and Documents/Projects)', () => {
    expect(projectOf(`${H}/Documents/Taxes/2025/return.pdf`, ctx)).toEqual({ dir: `${H}/Documents/Taxes`, name: 'Taxes', kind: 'project' });
    expect(projectOf(`${H}/Desktop/Moodboard/a.png`, ctx).name).toBe('Moodboard');
    expect(projectOf(`${H}/Documents/Projects/site/package.json`, ctx)).toMatchObject({ dir: `${H}/Documents/Projects/site`, name: 'site' });
    // Right inside: the container itself.
    expect(projectOf(`${H}/Documents/Budget.xlsx`, ctx)).toEqual({ dir: `${H}/Documents`, name: 'Documents', kind: 'folder' });
  });
  it('keeps Downloads as one group and falls back to the shared folder elsewhere', () => {
    expect(projectOf(`${H}/Downloads/brand-kit/logo.svg`, ctx)).toEqual({ dir: `${H}/Downloads`, name: 'Downloads', kind: 'downloads' });
    expect(projectOf(`${H}/Pictures/Lisbon/tram.jpg`, ctx)).toEqual({ dir: `${H}/Pictures/Lisbon`, name: 'Lisbon', kind: 'folder' });
    expect(projectOf('/mnt/data/work/alpha/notes/plan.md', ctx)).toEqual({ dir: '/mnt/data/work/alpha', name: 'alpha', kind: 'project' });
  });
  it('works with Windows paths', () => {
    const w = { home: 'C:\\Users\\ana' };
    expect(projectOf('C:\\Users\\ana\\Documents\\Thesis\\ch1.docx', w)).toEqual({ dir: 'C:\\Users\\ana\\Documents\\Thesis', name: 'Thesis', kind: 'project' });
    expect(projectOf('C:\\Users\\ana\\source\\repos\\app\\src\\main.cs', w).dir).toBe('C:\\Users\\ana\\source\\repos\\app');
  });
});

describe('Jump back in', () => {
  const files = [
    f(`${H}/Developer/keeper/src/a.ts`, 100),
    f(`${H}/Downloads/invoice.pdf`, 95),
    f(`${H}/Developer/keeper/README.md`, 90),
    f(`${H}/Documents/Taxes/w2.pdf`, 80),
    f(`${H}/Downloads/photo.jpg`, 70),
    f(`${H}/Pictures/one.jpg`, 60),
    f(`${H}/Developer/keeper/docs/x.md`, 50),
  ];
  it('groups by project, newest group first, single files gathered at the end', () => {
    const { groups, flat } = groupRecent(files, ctx);
    expect(flat).toBe(false);
    expect(groups.map((g) => g.name)).toEqual(['keeper', 'Downloads', 'Other recent files']);
    expect(groups[0].items.map((x) => x.mtime)).toEqual([100, 90, 50]);
    expect(groups[2].items.map((x) => x.mtime)).toEqual([80, 60]);
  });
  it('caps groups and files per group', () => {
    const many = Array.from({ length: 30 }, (_, i) => f(`${H}/Documents/P${i % 6}/f${i}.txt`, 1000 - i));
    const { groups } = groupRecent(many, ctx, { maxGroups: 3, perGroup: 2 });
    expect(groups).toHaveLength(4);
    expect(groups.slice(0, 3).map((g) => g.name)).toEqual(['P0', 'P1', 'P2']);
    expect(groups.every((g) => g.items.length <= 2)).toBe(true);
    expect(groups[3].dir).toBe('');
  });
  it('falls back to one flat list when there is no clear grouping', () => {
    const scattered = [f(`${H}/Pictures/a/1.jpg`, 3), f(`${H}/Music/b/2.mp3`, 2), f(`${H}/Videos/c/3.mp4`, 1)];
    const r = groupRecent(scattered, ctx);
    expect(r.flat).toBe(true);
    expect(r.groups[0].items.map((x) => x.mtime)).toEqual([3, 2, 1]);
    // Everything in one place is not a grouping either.
    expect(groupRecent([f(`${H}/Downloads/a`, 2), f(`${H}/Downloads/b`, 1)], ctx).flat).toBe(true);
    expect(groupRecent([], ctx)).toMatchObject({ flat: true });
  });
});
