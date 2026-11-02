import { isRecord, parseYaml, splitFrontmatter } from "../engine/index.js";
import type { GitHubClient } from "../github/index.js";
import { DocRepo } from "./docrepo.js";
import type { Kind } from "./kinds.js";
import { normaliseId, type Refusal } from "./write.js";

export interface ShownDocument {
  ok: true;
  key: string;
  file: string;
  ref: string;
  frontmatter: Record<string, unknown>;
  body: string;
  text: string;
}

export interface ListedDocument {
  id: string;
  file: string;
  title: string;
  state: string;
  category?: string;
  intent: string;
}

function parse(text: string): { fm: Record<string, unknown>; body: string } {
  const split = splitFrontmatter(text);
  if (!split) return { fm: {}, body: text };
  try {
    const fm = parseYaml(split.frontmatter);
    return { fm: isRecord(fm) ? fm : {}, body: split.body };
  } catch {
    return { fm: {}, body: split.body };
  }
}

/** `<noun> show <ID>` at a ref. */
export async function showDocument(client: GitHubClient, kind: Kind, idInput: string, ref: string): Promise<ShownDocument | Refusal> {
  const id = normaliseId(kind, idInput);
  if (!id) return { ok: false, message: `\`${idInput}\` is not a ${kind.prefix} ID`, nextAction: `Pass an ID like ${kind.prefix}-0042.` };
  const repo = new DocRepo(client);
  const hit = await repo.findNumbered(kind.folder!, id.slice(kind.prefix!.length + 1), [ref]);
  if (!hit) return { ok: false, message: `${id} does not exist on \`${ref}\``, nextAction: `List the documents with \`idc365-decisions ${kind.noun} list --ref ${ref}\`.` };
  const text = (await repo.text(hit.file, ref))!;
  const { fm, body } = parse(text);
  return { ok: true, key: id, file: hit.file, ref, frontmatter: fm, body, text };
}

/** `code show <path>` at a ref. */
export async function showShadow(client: GitHubClient, code: { key: string; file: string }, ref: string): Promise<ShownDocument | Refusal> {
  const text = await new DocRepo(client).text(code.file, ref);
  if (text === undefined) return { ok: false, message: `${code.key} has no shadow document on \`${ref}\``, nextAction: "Create it with `idc365-decisions code create`." };
  const { fm, body } = parse(text);
  return { ok: true, key: code.key, file: code.file, ref, frontmatter: fm, body, text };
}

/** `<noun> list` at a ref: reads every document in the type folder (until the index exists). */
export async function listDocuments(client: GitHubClient, kind: Kind, ref: string, filter: { state?: string; category?: string } = {}): Promise<ListedDocument[]> {
  const repo = new DocRepo(client);
  const entries = ((await repo.folder(`docs/${kind.folder}`, ref)) ?? []).filter((e) => e.type === "file" && /^[0-9]{4,}-.+\.md$/.test(e.name));
  const out: ListedDocument[] = [];
  // Read in small batches to stay gentle on the API.
  for (let i = 0; i < entries.length; i += 8) {
    const batch = await Promise.all(entries.slice(i, i + 8).map(async (e) => ({ e, text: (await repo.text(e.path, ref)) ?? "" })));
    for (const { e, text } of batch) {
      const { fm } = parse(text);
      const doc: ListedDocument = {
        id: typeof fm.id === "string" ? fm.id : `${kind.prefix}-${e.name.split("-")[0]}`,
        file: e.path,
        title: String(fm.title ?? ""),
        state: String(fm.state ?? ""),
        category: typeof fm.category === "string" ? fm.category : undefined,
        intent: String(fm.intent ?? ""),
      };
      if (filter.state && doc.state !== filter.state) continue;
      if (filter.category && doc.category !== filter.category) continue;
      out.push(doc);
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
