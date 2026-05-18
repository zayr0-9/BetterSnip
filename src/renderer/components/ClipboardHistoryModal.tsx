import React, { useEffect, useMemo, useState } from "react";
import type { ClipboardHistoryItem } from "../../types";
import { Icons } from "./Icons";

function formatTime(value: number): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function mediaUrl(filePath: string, version: number): string {
  const bytes = new TextEncoder().encode(filePath);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return `bettersnip-file://local/${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}?v=${version}`;
}

function typeLabel(item: ClipboardHistoryItem): string {
  if (item.type === "text") return "Text";
  if (item.type === "image") return "Image";
  return item.filePaths?.length === 1 ? "File" : "Files";
}

export function ClipboardHistoryModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ClipboardHistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  async function loadItems() {
    setItems(await window.betterSnip.listClipboardHistory());
  }

  useEffect(() => {
    if (!open) return;
    void loadItems();
    window.betterSnip.onClipboardHistoryChanged(() => void loadItems());
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.preview, item.name, item.text, ...(item.filePaths || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [items, query]);

  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent px-4 py-5">
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-white/55 bg-slate-100/92 text-slate-950 shadow-2xl shadow-slate-950/35 backdrop-blur-[140px] backdrop-brightness-110 backdrop-saturate-200 ring-1 ring-slate-950/10 before:pointer-events-none before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/80 before:via-sky-50/35 before:to-slate-300/45 before:content-[''] dark:border-white/18 dark:bg-slate-950/90 dark:text-white dark:shadow-black/60 dark:backdrop-brightness-75 dark:ring-black/35 dark:before:from-white/12 dark:before:via-slate-900/45 dark:before:to-black/55">
        <div className="relative z-10 flex items-start justify-between gap-6 px-7 pb-4 pt-6">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-950 dark:text-white">
              Clipboard History
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-200">
              BetterSnip keeps copied text, images, and files here. Videos are
              ignored.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-600 dark:text-slate-200 transition hover:bg-slate-950/5 dark:hover:bg-white/10 hover:text-slate-950 dark:hover:text-white"
            aria-label="Close clipboard history"
          >
            <Icons.Close className="h-5 w-5" />
          </button>
        </div>

        <div className="relative z-10 flex flex-col gap-3 px-7 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clipboard history…"
            className="h-12 flex-1 rounded-2xl bg-slate-950/5 dark:bg-white/10 px-4 text-sm font-medium text-slate-950 dark:text-white outline-none ring-1 ring-transparent transition placeholder:text-slate-500 dark:placeholder:text-slate-300 focus:bg-white/70 dark:focus:bg-white/15 focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={async () => {
              await window.betterSnip.clearClipboardHistory();
              setStatus("Clipboard history cleared");
              await loadItems();
            }}
            className="h-12 rounded-2xl px-4 text-sm font-semibold text-red-600 dark:text-red-100 transition hover:bg-red-500/10 dark:hover:bg-red-500/25"
          >
            Clear history
          </button>
        </div>

        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          {!filtered.length ? (
            <div className="grid min-h-[360px] place-items-center rounded-3xl bg-slate-950/5 dark:bg-white/10 text-center">
              <div>
                <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-blue-500/15 dark:bg-blue-500/20 text-blue-700 dark:text-blue-100">
                  <Icons.Copy className="h-6 w-6" />
                </div>
                <p className="font-semibold text-slate-950 dark:text-white">
                  No clipboard items yet
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-200">
                  Copy text, images, or files while clipboard history is
                  enabled.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((item) => {
                const expanded = expandedIds.has(item.id);
                const previewText =
                  item.preview || item.name || "Clipboard item";
                const content = item.text || previewText;
                const canExpand =
                  (item.type === "image" && !!item.filePath) ||
                  (item.type === "text" &&
                    content.trim().length > previewText.trim().length);

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      if (canExpand) toggleExpanded(item.id);
                    }}
                    className={`rounded-3xl px-3 py-4 transition hover:bg-slate-950/5 dark:hover:bg-white/10 sm:px-4 ${
                      canExpand ? "cursor-pointer" : ""
                    }`}
                    role={canExpand ? "button" : undefined}
                    tabIndex={canExpand ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (!canExpand) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleExpanded(item.id);
                      }
                    }}
                  >
                    <div
                      className={`grid gap-5 sm:items-center ${
                        "sm:grid-cols-[104px_minmax(0,1fr)_auto]"
                      }`}
                    >
                      <div
                        className={`grid place-items-center overflow-hidden rounded-2xl bg-slate-950/5 dark:bg-white/10 text-slate-600 dark:text-slate-200 ring-1 ring-slate-950/10 dark:ring-white/15 ${
                          "h-24 w-24"
                        }`}
                      >
                        {item.type === "image" && item.filePath ? (
                          <img
                            src={mediaUrl(item.filePath, item.createdAt)}
                            alt="Clipboard image preview"
                            className="h-full w-full object-contain"
                          />
                        ) : item.type === "files" ? (
                          <Icons.Folder className="h-8 w-8" />
                        ) : (
                          <Icons.Copy className="h-8 w-8" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-blue-500/15 dark:bg-blue-500/20 px-2.5 py-1 text-xs font-bold text-blue-700 dark:text-blue-100">
                            {typeLabel(item)}
                          </span>
                          <span className="text-xs font-semibold text-slate-600 dark:text-slate-200">
                            {formatTime(item.createdAt)}
                          </span>
                          {formatBytes(item.size) && (
                            <span className="text-xs font-semibold text-slate-600 dark:text-slate-200">
                              {formatBytes(item.size)}
                            </span>
                          )}
                        </div>
                        <div
                          className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out ${
                            expanded && canExpand
                              ? "grid-rows-[0fr] opacity-0"
                              : "grid-rows-[1fr] opacity-100"
                          }`}
                        >
                          <div className="min-h-0 overflow-hidden">
                            <p
                              className={`mt-2 break-words font-semibold text-slate-950 dark:text-white selection:bg-blue-600 selection:text-white ${
                                item.type === "image"
                                  ? "line-clamp-4 text-lg leading-7"
                                  : "line-clamp-3 text-base leading-6"
                              }`}
                            >
                              {previewText}
                            </p>
                            {item.type === "files" &&
                              !!item.filePaths?.length && (
                                <p className="mt-1 truncate text-sm font-medium text-slate-600 dark:text-slate-200 selection:bg-blue-600 selection:text-white">
                                  {item.filePaths.join(" • ")}
                                </p>
                              )}
                          </div>
                        </div>

                        {canExpand && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            className={`grid cursor-default overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out ${
                              expanded
                                ? "grid-rows-[1fr] opacity-100"
                                : "grid-rows-[0fr] opacity-0"
                            }`}
                          >
                            <div className="min-h-0 overflow-hidden">
                              {item.type === "image" && item.filePath ? (
                                <div className="mt-3 rounded-3xl bg-slate-950/5 dark:bg-white/10 p-3 ring-1 ring-slate-950/10 dark:ring-white/15">
                                  <img
                                    src={mediaUrl(
                                      item.filePath,
                                      item.createdAt,
                                    )}
                                    alt="Expanded clipboard image preview"
                                    className="max-h-[56vh] w-full rounded-2xl object-contain"
                                  />
                                </div>
                              ) : (
                                <pre className="mt-3 max-h-[48vh] overflow-auto whitespace-pre-wrap break-words rounded-3xl bg-slate-950/5 dark:bg-white/10 p-5 text-sm font-medium leading-6 text-slate-950 dark:text-white ring-1 ring-slate-950/10 dark:ring-white/15 selection:bg-blue-600 selection:text-white">
                                  {content}
                                </pre>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        {canExpand && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpanded(item.id);
                            }}
                            className="grid h-10 w-10 place-items-center rounded-2xl text-slate-600 dark:text-slate-200 transition hover:bg-slate-950/5 dark:hover:bg-white/10 hover:text-slate-950 dark:hover:text-white"
                            aria-expanded={expanded}
                            aria-label={
                              expanded
                                ? "Collapse clipboard item"
                                : "Expand clipboard item"
                            }
                          >
                            <Icons.ChevronDown
                              className={`h-5 w-5 transition-transform duration-300 ${
                                expanded ? "rotate-180" : "rotate-0"
                              }`}
                            />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await window.betterSnip.copyClipboardHistoryItem(
                              item.id,
                            );
                            setStatus("Copied to clipboard");
                          }}
                          className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700"
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await window.betterSnip.deleteClipboardHistoryItem(
                              item.id,
                            );
                            await loadItems();
                          }}
                          className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-200 transition hover:bg-slate-950/5 dark:hover:bg-white/10 hover:text-slate-950 dark:hover:text-white"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="relative z-10 px-7 py-4 text-sm font-medium text-slate-600 dark:text-slate-200">
          {status ||
            `${items.length} saved item${items.length === 1 ? "" : "s"}`}
        </div>
      </div>
    </div>
  );
}
