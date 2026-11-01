// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Small builders so each catalogue entry stays one readable line.

import type { After, Category, Choice, Op, Os, Risk, SettingDef } from './types';

/** "Not set": writing it removes Keeper's value so the system's own default applies. */
export const UNSET = '<unset>';

type Extra = Partial<Pick<SettingDef, 'admin' | 'after' | 'risk' | 'warning' | 'versions' | 'keywords' | 'sources' | 'removeToRestore' | 'unit'>>;

export interface Builder {
  toggle(id: string, category: Category, title: string, description: string, op: Op, on: string, off: string, systemDefault: string, extra?: Extra): SettingDef;
  choice(id: string, category: Category, title: string, description: string, op: Op, choices: Choice[], systemDefault: string, extra?: Extra): SettingDef;
  number(id: string, category: Category, title: string, description: string, op: Op, min: number, max: number, systemDefault: string, extra?: Extra): SettingDef;
  text(id: string, category: Category, title: string, description: string, op: Op, systemDefault: string, extra?: Extra): SettingDef;
  advice(id: string, category: Category, title: string, description: string, op: Op, steps: string[], extra?: Extra): SettingDef;
}

export function builder(os: Os, prefix: string, defaults: { sources: string[]; after?: After; risk?: Risk }): Builder {
  const base = (id: string, category: Category, title: string, description: string, op: Op, extra: Extra = {}) => ({
    id: `${prefix}.${id}`,
    os,
    category,
    title,
    description,
    op,
    admin: false,
    after: defaults.after ?? 'none',
    risk: defaults.risk ?? 'low',
    sources: defaults.sources,
    ...extra,
  });
  return {
    toggle: (id, category, title, description, op, on, off, systemDefault, extra) => ({ ...base(id, category, title, description, op, extra), kind: 'toggle', on, off, systemDefault }),
    choice: (id, category, title, description, op, choices, systemDefault, extra) => ({ ...base(id, category, title, description, op, extra), kind: 'choice', choices, systemDefault }),
    number: (id, category, title, description, op, min, max, systemDefault, extra) => ({ ...base(id, category, title, description, op, extra), kind: 'number', min, max, systemDefault }),
    text: (id, category, title, description, op, systemDefault, extra) => ({ ...base(id, category, title, description, op, extra), kind: 'text', systemDefault }),
    advice: (id, category, title, description, op, steps, extra) => ({ ...base(id, category, title, description, op, extra), kind: 'text', systemDefault: '', steps }),
  };
}

export const c = (value: string, label: string): Choice => ({ value, label });
