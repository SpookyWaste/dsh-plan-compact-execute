/**
 * Session stand-ins for the host-half tests.
 *
 * The tool-pairing helpers read only `surface.nodes`, `surface.replaceGeneration`,
 * `eventAt(seq)`, and the event shapes below, so a stub session is enough to
 * exercise the real range rule without constructing a durable log.
 */

/** One surface node: an assistant message carries `calls` tool calls; anything else is inert. */
export function node(seq, type, calls = 0) {
  return {
    seq,
    type,
    data: type === "assistant/message" ? { message: { content: Array.from({ length: calls }, () => ({ type: "tool-call" })) } } : {},
  };
}

/** Session stand-in exposing exactly what the host half reads. */
export function session(entries, { tokensPerNode = 10 } = {}) {
  const bySeq = new Map(entries.map((entry) => [entry.seq, entry]));
  const surface = {
    nodes: entries.map((entry) => entry.seq),
    replaceGeneration: 0,
  };
  return {
    session: {
      surface,
      eventAt: (seq) => bySeq.get(seq),
    },
    measurement: { nodes: surface.nodes.map((seq) => ({ seq, tokens: tokensPerNode })) },
  };
}