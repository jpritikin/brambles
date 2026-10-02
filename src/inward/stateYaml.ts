export interface DrugState {
    key: string;
    dose: number;
    label: string;
}

export interface PartState {
    emoji: string;
    feeling: string;
    blendUrgency: number;
    volition: number;
}

export const STATE_VERSION = 1;

export const LOOKS_LIKE_STATE = /^(version|selfKnob|drugs|parts):/m;

export interface ExplorerState {
    selfKnob: number;
    drugs: DrugState[];
    parts: PartState[];
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

export function stateToYaml(state: ExplorerState): string {
    const lines = [`version: ${STATE_VERSION}`, `selfKnob: ${round(state.selfKnob)}`];
    lines.push(state.drugs.length ? "drugs:" : "drugs: []");
    for (const d of state.drugs) {
        lines.push(`  - key: ${d.key}  # ${d.label}`, `    dose: ${round(d.dose)}`);
    }
    lines.push(state.parts.length ? "parts:" : "parts: []");
    for (const p of state.parts) {
        lines.push(
            `  - emoji: ${JSON.stringify(p.emoji)}`,
            `    feeling: ${JSON.stringify(p.feeling)}`,
            `    blendUrgency: ${round(p.blendUrgency)}`,
            `    volition: ${round(p.volition)}`,
        );
    }
    return lines.join("\n") + "\n";
}

type Scalar = string | number;
type Record_ = Record<string, Scalar>;

function parseScalar(raw: string): Scalar {
    const quoted = raw.match(/^"(?:[^"\\]|\\.)*"/);
    if (quoted) return JSON.parse(quoted[0]);
    const bare = raw.replace(/\s+#.*$/, "").trim();
    return bare !== "" && !isNaN(Number(bare)) ? Number(bare) : bare;
}

function parseSections(text: string): { top: Record_; lists: Record<string, Record_[]> } {
    const top: Record_ = {};
    const lists: Record<string, Record_[]> = {};
    let section: Record_[] | null = null;
    let item: Record_ | null = null;
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith("#")) continue;
        const m = line.match(/^(\s*)(- )?([A-Za-z]\w*):\s*(.*)$/);
        if (!m) throw new Error(`Cannot parse line: "${line.trim()}"`);
        const [, indent, dash, key, value] = m;
        if (!indent && !dash) {
            if (value === "" || value.startsWith("[]")) {
                section = lists[key] = [];
            } else {
                top[key] = parseScalar(value);
                section = null;
            }
            item = null;
            continue;
        }
        if (!section) throw new Error(`Unexpected indented line: "${line.trim()}"`);
        if (dash) section.push((item = {}));
        if (!item) throw new Error(`Unexpected line: "${line.trim()}"`);
        item[key] = parseScalar(value);
    }
    return { top, lists };
}

const num = (v: Scalar | undefined, fallback: number): number => (typeof v === "number" ? v : fallback);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function yamlToState(text: string): ExplorerState {
    const { top, lists } = parseSections(text);
    if (top.version === undefined) throw new Error("Missing \"version\" line.");
    if (top.version !== STATE_VERSION) throw new Error(`Unsupported state version ${top.version} (expected ${STATE_VERSION}).`);
    return {
        selfKnob: clamp(num(top.selfKnob, 0.6), 0, 1),
        drugs: (lists.drugs ?? []).map((d) => ({ key: String(d.key), dose: clamp(num(d.dose, 0), 0, 1), label: "" })),
        parts: (lists.parts ?? []).map((p) => ({
            emoji: String(p.emoji ?? ""),
            feeling: String(p.feeling ?? ""),
            blendUrgency: clamp(num(p.blendUrgency, 0), 0, 1),
            volition: clamp(num(p.volition, 0), -1, 1),
        })),
    };
}
