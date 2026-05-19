import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ClipboardHistoryItem } from "../../types";
import { Icons } from "./Icons";

const DEFAULT_LIST_HEIGHT = 620;
const XL_LIST_HEIGHT = 760;
const ROW_GAP = 0;
const COMPACT_TEXT_ROW_HEIGHT = 132;
const COMPACT_IMAGE_ROW_HEIGHT = 132;
const EXPANDED_TEXT_EXTRA_HEIGHT = 360;
const EXPANDED_IMAGE_PREVIEW_WIDTH = 720;
const EXPANDED_IMAGE_MIN_EXTRA_HEIGHT = 170;
const EXPANDED_IMAGE_MAX_EXTRA_HEIGHT = 520;
const EXPANDED_IMAGE_VERTICAL_CHROME = 48;
const OVERSCAN_ROWS = 3;

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

function expandedImageExtraHeight(item: ClipboardHistoryItem): number {
  if (!item.width || !item.height || item.width <= 0 || item.height <= 0) {
    return EXPANDED_IMAGE_MAX_EXTRA_HEIGHT;
  }
  const scaledHeight =
    (item.height / item.width) * EXPANDED_IMAGE_PREVIEW_WIDTH +
    EXPANDED_IMAGE_VERTICAL_CHROME;
  return Math.round(
    Math.min(
      EXPANDED_IMAGE_MAX_EXTRA_HEIGHT,
      Math.max(EXPANDED_IMAGE_MIN_EXTRA_HEIGHT, scaledHeight),
    ),
  );
}

function ClipboardHistoryRow({
  item,
  expanded,
  style,
  absolute = false,
  onToggleExpanded,
  onSetFavorite,
  onCopy,
  onDelete,
}: {
  item: ClipboardHistoryItem;
  expanded: boolean;
  style?: React.CSSProperties;
  absolute?: boolean;
  onToggleExpanded: () => void;
  onSetFavorite: (favorite: boolean) => void;
  onCopy: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const previewText = item.preview || item.name || "Clipboard item";
  const content = item.text || previewText;
  const canExpand =
    (item.type === "image" && !!item.filePath) ||
    (item.type === "text" && content.trim().length > previewText.trim().length);

  return (
    <div
      onClick={() => {
        if (canExpand) onToggleExpanded();
      }}
      className={`${
        absolute ? "absolute left-0 right-0" : ""
      } rounded-3xl border-b border-slate-950/5 px-3 py-4 transition hover:bg-slate-950/5 dark:border-white/10 dark:hover:bg-white/10 sm:px-4 ${
        canExpand ? "cursor-pointer" : ""
      }`}
      style={style}
      role={canExpand ? "button" : undefined}
      tabIndex={canExpand ? 0 : undefined}
      onKeyDown={(e) => {
        if (!canExpand) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleExpanded();
        }
      }}
    >
      <div className="grid gap-5 sm:grid-cols-[104px_minmax(0,1fr)_auto] sm:items-center">
        <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-2xl bg-slate-950/5 text-slate-600 ring-1 ring-slate-950/10 dark:bg-white/10 dark:text-slate-200 dark:ring-white/15">
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
            <span className="rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-100">
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
                className={`mt-2 break-words font-semibold text-slate-950 selection:bg-blue-600 selection:text-white dark:text-white ${
                  item.type === "image"
                    ? "line-clamp-4 text-lg leading-7"
                    : "line-clamp-3 text-base leading-6"
                }`}
              >
                {previewText}
              </p>
              {item.type === "files" && !!item.filePaths?.length && (
                <p className="mt-1 truncate text-sm font-medium text-slate-600 selection:bg-blue-600 selection:text-white dark:text-slate-200">
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
                  <div className="mt-3 rounded-3xl bg-slate-950/5 p-3 ring-1 ring-slate-950/10 dark:bg-white/10 dark:ring-white/15">
                    <img
                      src={mediaUrl(item.filePath, item.createdAt)}
                      alt="Expanded clipboard image preview"
                      className="max-h-[56vh] w-full rounded-2xl object-contain"
                    />
                  </div>
                ) : (
                  <pre className="mt-3 max-h-[48vh] overflow-auto whitespace-pre-wrap break-words rounded-3xl bg-slate-950/5 p-5 text-sm font-medium leading-6 text-slate-950 ring-1 ring-slate-950/10 selection:bg-blue-600 selection:text-white dark:bg-white/10 dark:text-white dark:ring-white/15">
                    {content}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSetFavorite(!item.favorite);
            }}
            className={`grid h-10 w-10 place-items-center rounded-2xl transition ${
              item.favorite
                ? "bg-amber-400/20 text-amber-600 hover:bg-amber-400/30 dark:text-amber-200"
                : "text-slate-600 hover:bg-slate-950/5 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-white/10 dark:hover:text-white"
            }`}
            aria-label={
              item.favorite ? "Remove from favorites" : "Add to favorites"
            }
          >
            <Icons.Sparkle className="h-5 w-5" />
          </button>
          {canExpand && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpanded();
              }}
              className="grid h-10 w-10 place-items-center rounded-2xl text-slate-600 transition hover:bg-slate-950/5 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-white/10 dark:hover:text-white"
              aria-expanded={expanded}
              aria-label={
                expanded ? "Collapse clipboard item" : "Expand clipboard item"
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
              await onCopy();
            }}
            className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              await onDelete();
            }}
            className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-950/5 hover:text-slate-950 dark:text-slate-200 dark:hover:bg-white/10 dark:hover:text-white"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClipboardHistoryModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollRaf = useRef<number | null>(null);
  const [items, setItems] = useState<ClipboardHistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [listHeight, setListHeight] = useState(DEFAULT_LIST_HEIGHT);

  async function loadItems() {
    setItems(await window.betterSnip.listClipboardHistory());
  }

  useEffect(() => {
    if (!open) return;
    setScrollTop(0);
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    void loadItems();
    window.betterSnip.onClipboardHistoryChanged(() => void loadItems());
  }, [open]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateListHeight = () => {
      setListHeight(
        window.matchMedia("(min-width: 1280px)").matches
          ? XL_LIST_HEIGHT
          : DEFAULT_LIST_HEIGHT,
      );
    };

    updateListHeight();
    window.addEventListener("resize", updateListHeight);
    return () => window.removeEventListener("resize", updateListHeight);
  }, []);

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

  const favoriteItems = useMemo(
    () => filtered.filter((item) => item.favorite),
    [filtered],
  );

  const historyItems = useMemo(
    () => filtered.filter((item) => !item.favorite),
    [filtered],
  );

  const rowLayout = useMemo(() => {
    let offset = 0;
    return historyItems.map((item) => {
      const expanded = expandedIds.has(item.id);
      const height =
        (item.type === "image"
          ? COMPACT_IMAGE_ROW_HEIGHT
          : COMPACT_TEXT_ROW_HEIGHT) +
        (expanded
          ? item.type === "image"
            ? expandedImageExtraHeight(item)
            : item.type === "text"
              ? EXPANDED_TEXT_EXTRA_HEIGHT
              : 0
          : 0);
      const top = offset;
      offset += height + ROW_GAP;
      return { item, top, height };
    });
  }, [expandedIds, historyItems]);

  const totalListHeight = rowLayout.length
    ? rowLayout[rowLayout.length - 1].top +
      rowLayout[rowLayout.length - 1].height
    : 0;

  const visibleRows = useMemo(() => {
    const viewportBottom = scrollTop + listHeight;
    return rowLayout.filter(
      ({ top, height }) =>
        top + height >= scrollTop - COMPACT_IMAGE_ROW_HEIGHT * OVERSCAN_ROWS &&
        top <= viewportBottom + COMPACT_IMAGE_ROW_HEIGHT * OVERSCAN_ROWS,
    );
  }, [listHeight, rowLayout, scrollTop]);

  const onScroll = useCallback(() => {
    if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      setScrollTop(scrollerRef.current?.scrollTop ?? 0);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current);
    };
  }, []);

  useEffect(() => {
    setScrollTop(0);
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [query]);

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

  async function setFavorite(item: ClipboardHistoryItem, favorite: boolean) {
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, favorite } : entry,
      ),
    );
    await window.betterSnip.setClipboardHistoryFavorite(item.id, favorite);
    setStatus(favorite ? "Added to favorites" : "Removed from favorites");
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-transparent px-4 py-5"
      onMouseDown={onClose}
    >
      <div
        className="relative flex max-h-[82vh] w-full max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-white/55 bg-slate-100/92 text-slate-950 shadow-2xl shadow-slate-950/35 backdrop-blur-[140px] backdrop-brightness-110 backdrop-saturate-200 ring-1 ring-slate-950/10 before:pointer-events-none before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/80 before:via-sky-50/35 before:to-slate-300/45 before:content-[''] dark:border-white/18 dark:bg-slate-950/90 dark:text-white dark:shadow-black/60 dark:backdrop-brightness-75 dark:ring-black/35 dark:before:from-white/12 dark:before:via-slate-900/45 dark:before:to-black/55 xl:max-h-[96vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
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
            <div
              ref={scrollerRef}
              onScroll={onScroll}
              className="gallery-scroll overflow-y-auto pr-1"
              style={{
                height: Math.min(listHeight, Math.max(360, totalListHeight)),
              }}
            >
              {!!favoriteItems.length && (
                <section className="mb-3 rounded-3xl bg-amber-400/10 ring-1 ring-amber-500/20 dark:bg-amber-300/10 dark:ring-amber-200/15">
                  <button
                    type="button"
                    onClick={() => setFavoritesCollapsed((value) => !value)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Icons.Sparkle className="h-5 w-5 text-amber-600 dark:text-amber-200" />
                      <span className="text-sm font-extrabold text-slate-950 dark:text-white">
                        Favorites
                      </span>
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-200">
                        {favoriteItems.length}
                      </span>
                    </div>
                    <Icons.ChevronDown
                      className={`h-5 w-5 text-slate-600 transition-transform duration-300 dark:text-slate-200 ${
                        favoritesCollapsed ? "-rotate-90" : "rotate-0"
                      }`}
                    />
                  </button>
                  <div
                    className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out ${
                      favoritesCollapsed
                        ? "grid-rows-[0fr] opacity-0"
                        : "grid-rows-[1fr] opacity-100"
                    }`}
                  >
                    <div className="min-h-0 overflow-hidden px-2 pb-2">
                      {favoriteItems.map((item) => (
                        <ClipboardHistoryRow
                          key={item.id}
                          item={item}
                          expanded={expandedIds.has(item.id)}
                          onToggleExpanded={() => toggleExpanded(item.id)}
                          onSetFavorite={(favorite) =>
                            void setFavorite(item, favorite)
                          }
                          onCopy={async () => {
                            await window.betterSnip.copyClipboardHistoryItem(
                              item.id,
                            );
                            setStatus("Copied to clipboard");
                          }}
                          onDelete={async () => {
                            await window.betterSnip.deleteClipboardHistoryItem(
                              item.id,
                            );
                            await loadItems();
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {historyItems.length ? (
                <div className="relative" style={{ height: totalListHeight }}>
                  {visibleRows.map(({ item, top, height }) => (
                    <ClipboardHistoryRow
                      key={item.id}
                      item={item}
                      expanded={expandedIds.has(item.id)}
                      absolute
                      style={{ top, height }}
                      onToggleExpanded={() => toggleExpanded(item.id)}
                      onSetFavorite={(favorite) =>
                        void setFavorite(item, favorite)
                      }
                      onCopy={async () => {
                        await window.betterSnip.copyClipboardHistoryItem(
                          item.id,
                        );
                        setStatus("Copied to clipboard");
                      }}
                      onDelete={async () => {
                        await window.betterSnip.deleteClipboardHistoryItem(
                          item.id,
                        );
                        await loadItems();
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid min-h-[220px] place-items-center rounded-3xl bg-slate-950/5 text-center dark:bg-white/10">
                  <p className="text-sm font-semibold text-slate-600 dark:text-slate-200">
                    All matching items are in Favorites.
                  </p>
                </div>
              )}
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
