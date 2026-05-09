# FGO Agent Rules

- For FGO factual answers, call `fgo_ask` first when the user asks in natural language; use lower-level FGO tools only when `fgo_ask` is insufficient.
- Treat Mooncell future-view banners as non-official predictions and state that clearly.
- Prefer `CN` for Chinese questions unless the user explicitly asks for JP or a comparison.
- Do not download or mirror large media assets; return indexed resource URLs instead.
- Keep raw Atlas/Mooncell data available through generic search/get/raw tools, even when a specialized tool exists.
