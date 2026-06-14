// Persistent account roster (FE-M1). Replaces the old ephemeral per-event
// random addresses with a stable set of personas so every address the explorer
// shows resolves consistently to the same `/address/:addr` subject.
//
// `accountByAddr` ALWAYS resolves: known addresses carry labels + roles; any
// other 0x… is treated as an anonymous investor account (exactly how a real
// explorer renders an unlabelled address). This makes MI-5 (every event actor
// resolves) and MI-6 (every referenced id resolves) true by construction.

import type { Account, AccountRole } from "../types";
import { assets, disputes, validators, DEMO_WALLET, protocolConfig } from "./data";

/** Named retail investor personas — give holder ledgers & address pages real names. */
export const INVESTOR_PERSONAS: { address: string; label: string }[] = [
  { address: DEMO_WALLET, label: "Demo wallet" },
  { address: "0x1a01investor00000000000000000000000000000000000000000000adunni01", label: "Adunni Capital" },
  { address: "0x1a02investor00000000000000000000000000000000000000000000sahel002", label: "Sahel Microfund" },
  { address: "0x1a03investor00000000000000000000000000000000000000000000kofi0003", label: "Kofi Mensah" },
  { address: "0x1a04investor0000000000000000000000000000000000000000000zawadi04", label: "Zawadi Holdings" },
  { address: "0x1a05investor00000000000000000000000000000000000000000naledi005", label: "Naledi Ventures" },
  { address: "0x1a06investor0000000000000000000000000000000000000000chidi0006", label: "Chidi Okafor" },
  { address: "0x1a07investor000000000000000000000000000000000000000baraka007", label: "Baraka Fund" },
  { address: "0x1a08investor00000000000000000000000000000000000000amara0008", label: "Amara Diop" },
  { address: "0x1a09investor000000000000000000000000000000000000thabo00009", label: "Thabo Nkosi" },
  { address: "0x1a10investor000000000000000000000000000000000000ngozi00010", label: "Ngozi Eze" },
];

function addRole(map: Map<string, Account>, address: string, role: AccountRole, label?: string) {
  const existing = map.get(address);
  if (existing) {
    if (!existing.roles.includes(role)) existing.roles.push(role);
    if (!existing.label && label) existing.label = label;
    return;
  }
  map.set(address, { address, label, roles: [role], known: true });
}

const roster = new Map<string, Account>();

// Protocol-level addresses
addRole(roster, protocolConfig.admin, "admin", "Protocol admin");
addRole(roster, protocolConfig.treasury, "treasury", "Protocol treasury");
// Validators (operators)
for (const v of validators) addRole(roster, v.address, "validator", v.name);
// Entities (one per asset)
for (const a of assets) addRole(roster, a.entity, "entity", a.entityName);
// Challengers (from disputes)
for (const d of disputes) addRole(roster, d.challenger, "challenger");
// Named investors
for (const p of INVESTOR_PERSONAS) addRole(roster, p.address, "investor", p.label);

/** The explicit, labelled roster (for discovery/search; anonymous holders are not listed here). */
export const accounts: Account[] = Array.from(roster.values());

/** Resolve ANY address to an Account (anonymous investor fallback for unknown 0x…). */
export function accountByAddr(address: string): Account {
  return (
    roster.get(address) ?? {
      address,
      roles: ["investor"],
      known: false,
    }
  );
}

/** Short display name for an address: label if known, else the truncated address. */
export function accountLabel(address: string): string | undefined {
  return roster.get(address)?.label;
}

export const accountsByRole = (role: AccountRole): Account[] =>
  accounts.filter((a) => a.roles.includes(role));
