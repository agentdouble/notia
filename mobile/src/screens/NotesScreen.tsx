import type { Session } from "@supabase/supabase-js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextLayoutEventData,
  View,
  useWindowDimensions,
} from "react-native";

import * as api from "../lib/api";
import type { Theme } from "../lib/theme";
import { Note } from "../types/note";
import { formatSidebarTimestamp } from "../utils/dates";

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const sidebarWidth = 310;
const commandMenuWidth = 260;
const commandMenuRowHeight = 44;
const commandMenuPadding = 8;

type CommandOption = {
  id: string;
  title: string;
  description: string;
  command: string;
  insertText: string;
};

const COMMANDS: CommandOption[] = [
  {
    id: "generate",
    title: "Générer avec l'IA",
    description: "Insère /generate pour continuer",
    command: "generate",
    insertText: "/generate",
  },
  {
    id: "todo",
    title: "Todo",
    description: "Ajouter une tâche",
    command: "todo",
    insertText: "- [ ] ",
  },
  {
    id: "bullet",
    title: "Liste à puces",
    description: "Démarrer une liste",
    command: "bullet",
    insertText: "- ",
  },
  {
    id: "heading",
    title: "Titre",
    description: "Titre de section",
    command: "heading",
    insertText: "# ",
  },
];

const webNoOutline = Platform.OS === "web" ? ({ outlineStyle: "none", outlineWidth: 0, boxShadow: "none" } as any) : undefined;
const webCursorPointer = Platform.OS === "web" ? ({ cursor: "pointer" } as any) : undefined;

export function NotesScreen({
  session,
  onSignOut,
  theme,
  onToggleTheme,
}: {
  session: Session;
  onSignOut: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const token = session.access_token;
  const { width: windowWidth } = useWindowDimensions();
  const isMobileLayout = windowWidth < sidebarWidth + 420;
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [commandState, setCommandState] = useState<{ start: number; end: number; query: string } | null>(null);
  const [commandAnchor, setCommandAnchor] = useState<{ x: number; y: number } | null>(null);
  const [editorLayout, setEditorLayout] = useState({ width: 0, height: 0 });

  const editVersionRef = useRef(0);
  const saveAbortRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);
  const generateRequestIdRef = useRef(0);
  const selectionRef = useRef(selection);
  const draftContentRef = useRef(draftContent);
  const pendingGenerateRef = useRef<number | null>(null);
  const commandMeasureRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const commandDismissedRef = useRef<{ start: number; end: number; query: string; version: number } | null>(null);
  const scrollOffsetRef = useRef(0);

  const styles = useMemo(() => createStyles(theme), [theme]);
  const titlePlaceholderColor = theme.name === "dark" ? "#9aa0a6" : "#cbd5e1";
  const displayTitle = draftTitle === "Sans titre" || draftTitle === "Nouvelle note" ? "" : draftTitle;

  const selectedNote = useMemo(() => notes.find((n) => n.id === selectedNoteId) ?? null, [notes, selectedNoteId]);
  const visibleCommands = useMemo(() => {
    if (!commandState) return [];
    const query = commandState.query.toLowerCase();
    if (!query) return COMMANDS;
    return COMMANDS.filter((command) => {
      const title = command.title.toLowerCase();
      return command.command.startsWith(query) || title.includes(query);
    });
  }, [commandState]);
  const statusLabel = generateError
    ? generateError
    : saveError
    ? saveError
    : isGenerating
    ? "Génération…"
    : isSaving
    ? "Enregistrement…"
    : isDirty
    ? "Modifications non enregistrées"
    : "Synchronisé";

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    draftContentRef.current = draftContent;
  }, [draftContent]);

  useEffect(() => {
    if (!selectedNoteId) {
      setCommandState(null);
      commandDismissedRef.current = null;
      return;
    }
    if (selection.start !== selection.end) {
      setCommandState(null);
      return;
    }
    const next = findSlashCommand(draftContent, selection.start);
    const dismissed = commandDismissedRef.current;
    if (
      next &&
      dismissed &&
      editVersionRef.current === dismissed.version &&
      next.start === dismissed.start &&
      next.end === dismissed.end &&
      next.query === dismissed.query
    ) {
      setCommandState(null);
      return;
    }
    if (next) commandDismissedRef.current = null;
    setCommandState((prev) => {
      if (!next) return null;
      if (prev && prev.start === next.start && prev.end === next.end && prev.query === next.query) return prev;
      return next;
    });
  }, [draftContent, selection, selectedNoteId]);

  useEffect(() => {
    if (commandState) return;
    setCommandAnchor(null);
  }, [commandState]);

  function selectNote(note: Note) {
    setSelectedNoteId(note.id);
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setIsDirty(false);
    setSaveError(null);
    setGenerateError(null);
    setCommandState(null);
    commandDismissedRef.current = null;
    generateAbortRef.current?.abort();
    setIsGenerating(false);
    const nextPos = note.content.length;
    setSelection({ start: nextPos, end: nextPos });
  }

  function patchNoteLocal(noteId: string, patch: Partial<Note>) {
    setNotes((prev) => {
      const next = prev.map((note) => (note.id === noteId ? { ...note, ...patch } : note));
      next.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      return next;
    });
  }

  function applyContentUpdate(noteId: string, content: string) {
    editVersionRef.current += 1;
    setDraftContent(content);
    draftContentRef.current = content;
    setIsDirty(true);
    setGenerateError(null);
    patchNoteLocal(noteId, { content, updated_at: nowIso() });
  }

  function findSlashCommand(content: string, cursor: number) {
    const safeCursor = Math.max(0, Math.min(cursor, content.length));
    const lineStart = content.lastIndexOf("\n", safeCursor - 1) + 1;
    const beforeCursor = content.slice(lineStart, safeCursor);
    const slashIndex = beforeCursor.lastIndexOf("/");
    if (slashIndex === -1) return null;
    if (slashIndex > 0) {
      const prevChar = beforeCursor[slashIndex - 1];
      if (prevChar && !/\s/.test(prevChar)) return null;
    }
    const query = beforeCursor.slice(slashIndex + 1);
    if (/\s/.test(query)) return null;
    return { start: lineStart + slashIndex, end: safeCursor, query };
  }

  function findGenerateCommandRange(content: string, cursor: number) {
    const safeCursor = Math.max(0, Math.min(cursor, content.length));
    const lineStart = content.lastIndexOf("\n", safeCursor - 1) + 1;
    let lineEnd = content.indexOf("\n", safeCursor);
    if (lineEnd === -1) lineEnd = content.length;
    const line = content.slice(lineStart, lineEnd);
    if (line.trim() !== "/generate") return null;
    return { lineStart, lineEnd };
  }

  function stripCommandLine(content: string, range: { lineStart: number; lineEnd: number }) {
    const after =
      range.lineEnd < content.length && content[range.lineEnd] === "\n" ? range.lineEnd + 1 : range.lineEnd;
    return content.slice(0, range.lineStart) + content.slice(after);
  }

  function handleCommandMeasureLayout(event: NativeSyntheticEvent<TextLayoutEventData>) {
    const lines = event.nativeEvent.lines;
    if (!lines.length) return;
    const lastLine = lines[lines.length - 1];
    commandMeasureRef.current = lastLine;
    const nextX = lastLine.x + lastLine.width;
    const nextY = lastLine.y + lastLine.height - scrollOffsetRef.current;
    setCommandAnchor({ x: nextX, y: nextY });
  }

  function dismissCommandMenu(persist: boolean) {
    setCommandState((prev) => {
      if (persist && prev) {
        commandDismissedRef.current = { ...prev, version: editVersionRef.current };
      } else if (!persist) {
        commandDismissedRef.current = null;
      }
      return null;
    });
  }

  function applyCommand(option: CommandOption) {
    if (!selectedNoteId || !commandState) return;
    const currentContent = draftContentRef.current;
    const nextContent =
      currentContent.slice(0, commandState.start) + option.insertText + currentContent.slice(commandState.end);
    applyContentUpdate(selectedNoteId, nextContent);
    commandDismissedRef.current = null;
    const nextCursor = commandState.start + option.insertText.length;
    setSelection({ start: nextCursor, end: nextCursor });
    selectionRef.current = { start: nextCursor, end: nextCursor };
    setCommandState(null);
  }

  async function runGenerate(insertIndex: number, baseContent: string, baseVersion: number) {
    if (!selectedNoteId) return;

    generateAbortRef.current?.abort();
    const controller = new AbortController();
    generateAbortRef.current = controller;
    const requestId = generateRequestIdRef.current + 1;
    generateRequestIdRef.current = requestId;
    setIsGenerating(true);
    setGenerateError(null);

    try {
      const { suggestion } = await api.generateContinuation(
        token,
        { content: baseContent, cursor: insertIndex },
        controller.signal
      );
      if (controller.signal.aborted || generateRequestIdRef.current !== requestId) return;
      if (editVersionRef.current !== baseVersion || draftContentRef.current !== baseContent) {
        setGenerateError("Le contenu a changé, relance /generate.");
        return;
      }
      const nextContent = baseContent.slice(0, insertIndex) + suggestion + baseContent.slice(insertIndex);
      applyContentUpdate(selectedNoteId, nextContent);
      const nextCursor = insertIndex + suggestion.length;
      setSelection({ start: nextCursor, end: nextCursor });
      selectionRef.current = { start: nextCursor, end: nextCursor };
    } catch (e) {
      if (controller.signal.aborted) return;
      const message = e instanceof Error ? e.message : "Erreur de génération.";
      setGenerateError(message);
    } finally {
      if (!controller.signal.aborted) setIsGenerating(false);
    }
  }

  function queueGenerateFromCommand() {
    if (!selectedNoteId || isGenerating) return;
    const cursor = selectionRef.current.start;
    const commandRange = findGenerateCommandRange(draftContentRef.current, cursor);
    if (!commandRange) return;
    pendingGenerateRef.current = cursor;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listNotes(token)
      .then((data) => {
        if (cancelled) return;
        setNotes(data);
        if (data.length) {
          selectNote(data[0]);
        } else {
          setSelectedNoteId(null);
          setDraftTitle("");
          setDraftContent("");
        }
      })
      .catch((e) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Erreur lors du chargement des notes.";
        setError(message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveAbortRef.current?.abort();
      generateAbortRef.current?.abort();
    };
  }, [token]);

  useEffect(() => {
    if (!isMobileLayout) setIsSidebarOpen(false);
  }, [isMobileLayout]);

  useEffect(() => {
    if (!selectedNote) return;
    if (isDirty) return;
    setDraftTitle(selectedNote.title);
    setDraftContent(selectedNote.content);
  }, [selectedNoteId, selectedNote?.updated_at, isDirty, selectedNote]);

  useEffect(() => {
    if (!selectedNoteId) return;
    if (!isDirty) return;

    const versionToSave = editVersionRef.current;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      void persistDraft(selectedNoteId, draftTitle, draftContent, versionToSave);
    }, 650);

    return () => {
      if (!saveTimeoutRef.current) return;
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    };
  }, [draftTitle, draftContent, isDirty, selectedNoteId, token]);

  const filteredNotes = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return notes;
    return notes.filter((note) => (note.title || "Sans titre").toLowerCase().includes(query));
  }, [notes, search]);

  async function persistDraft(noteId: string, title: string, content: string, versionToSave: number): Promise<boolean> {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    saveAbortRef.current?.abort();
    const controller = new AbortController();
    saveAbortRef.current = controller;
    setIsSaving(true);
    setSaveError(null);

    try {
      const updated = await api.updateNote(token, noteId, { title, content }, controller.signal);
      patchNoteLocal(updated.id, updated);

      if (noteId === selectedNoteId && editVersionRef.current === versionToSave) {
        setIsDirty(false);
      }
      return true;
    } catch (e) {
      if (controller.signal.aborted) return false;
      const message = e instanceof Error ? e.message : "Erreur d’enregistrement.";
      setSaveError(message);
      return false;
    } finally {
      if (!controller.signal.aborted) setIsSaving(false);
    }
  }

  async function createNote() {
    setError(null);
    try {
      if (isDirty && selectedNoteId) {
        const ok = await persistDraft(selectedNoteId, draftTitle, draftContent, editVersionRef.current);
        if (!ok) return;
      }
      const created = await api.createNote(token, { title: "", content: "" });
      setNotes((prev) => [created, ...prev]);
      selectNote(created);
      if (isMobileLayout) closeSidebar();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erreur lors de la création.";
      setError(message);
    }
  }

  function closeSidebar() {
    setIsSidebarOpen(false);
  }

  function renderSidebar(variant: "docked" | "drawer") {
    const isDrawer = variant === "drawer";

    return (
      <View style={[styles.sidebar, isDrawer && styles.sidebarDrawer]}>
        <View style={styles.sidebarHeader}>
          <View style={styles.sidebarHeaderLeft}>
            <Text style={styles.appTitle}>agentdouble</Text>
            <Text style={styles.userLabel} numberOfLines={1}>
              {session.user.email ?? session.user.id}
            </Text>
          </View>
          <View style={styles.sidebarHeaderActions}>
            {isDrawer ? (
              <Pressable onPress={closeSidebar} style={({ pressed }) => [styles.iconButton, webCursorPointer, pressed && styles.pressed]}>
                <Text style={styles.iconButtonText}>×</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onToggleTheme} style={({ pressed }) => [styles.iconButton, webCursorPointer, pressed && styles.pressed]}>
              <Text style={styles.iconButtonText}>{theme.name === "dark" ? "☀︎" : "☾"}</Text>
            </Pressable>
            <Pressable onPress={onSignOut} style={({ pressed }) => [styles.iconButton, webCursorPointer, pressed && styles.pressed]}>
              <Text style={styles.iconButtonText}>⎋</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Chercher"
            placeholderTextColor={theme.colors.placeholder}
            underlineColorAndroid="transparent"
            style={[styles.searchInput, webNoOutline]}
          />
        </View>

        <View style={styles.navSection}>
          <Pressable style={({ pressed }) => [styles.navItem, webCursorPointer, pressed && styles.pressed]}>
            <Text style={styles.navIcon}>⌂</Text>
            <Text style={styles.navLabel}>Accueil</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.navItem, webCursorPointer, pressed && styles.pressed]}>
            <Text style={styles.navIcon}>✎</Text>
            <Text style={styles.navLabel}>Notes</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>Pages privées</Text>
          <Pressable onPress={createNote} style={({ pressed }) => [styles.newButton, webCursorPointer, pressed && styles.pressed]}>
            <Text style={styles.newButtonText}>+ Nouvelle</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.sidebarLoading}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={filteredNotes}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.notesListContent}
            renderItem={({ item }) => {
              const isSelected = item.id === selectedNoteId;
              return (
                <Pressable
                  onPress={async () => {
                    if (item.id === selectedNoteId) return;
                    if (isDirty && selectedNoteId) {
                      const ok = await persistDraft(selectedNoteId, draftTitle, draftContent, editVersionRef.current);
                      if (!ok) return;
                    }
                    selectNote(item);
                    if (isDrawer) closeSidebar();
                  }}
                  style={({ pressed }) => [
                    styles.noteRow,
                    isSelected && styles.noteRowSelected,
                    webCursorPointer,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.noteRowText}>
                    <Text style={styles.noteTitle} numberOfLines={1}>
                      {item.title || "Sans titre"}
                    </Text>
                    <Text style={styles.noteMeta} numberOfLines={1}>
                      {formatSidebarTimestamp(item.updated_at)}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {!isMobileLayout ? renderSidebar("docked") : null}

      <View style={[styles.main, !isMobileLayout && styles.mainWide]}>
        {isMobileLayout ? (
          <View style={styles.mobileHeader}>
            <Pressable onPress={() => setIsSidebarOpen(true)} style={({ pressed }) => [styles.iconButton, webCursorPointer, pressed && styles.pressed]}>
              <Text style={styles.iconButtonText}>☰</Text>
            </Pressable>
          </View>
        ) : null}
        {error ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Erreur</Text>
            <Text style={styles.emptySubtitle}>{error}</Text>
            <Pressable onPress={createNote} style={({ pressed }) => [styles.cta, webCursorPointer, pressed && styles.pressed]}>
              <Text style={styles.ctaText}>Nouvelle note</Text>
            </Pressable>
          </View>
        ) : !selectedNote ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Aucune note sélectionnée</Text>
            <Text style={styles.emptySubtitle}>Crée une note pour commencer.</Text>
            <Pressable onPress={createNote} style={({ pressed }) => [styles.cta, webCursorPointer, pressed && styles.pressed]}>
              <Text style={styles.ctaText}>Nouvelle note</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.editorWrap}>
            <View style={styles.editorHeader}>
              <TextInput
                value={displayTitle}
                onChangeText={(title) => {
                  editVersionRef.current += 1;
                  setDraftTitle(title);
                  setIsDirty(true);
                  setGenerateError(null);
                  patchNoteLocal(selectedNote.id, { title, updated_at: nowIso() });
                }}
                placeholder="Nouvelle page"
                placeholderTextColor={titlePlaceholderColor}
                underlineColorAndroid="transparent"
                style={[styles.editorTitle, styles.editorTitleInput, webNoOutline]}
              />
              <View style={styles.saveStatusBanner}>
                <Text style={styles.saveStatusText} numberOfLines={1}>
                  {statusLabel}
                </Text>
              </View>
            </View>
            <View
              style={styles.editorBodyWrap}
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                setEditorLayout({ width, height });
              }}
            >
              <TextInput
                value={draftContent}
                onChangeText={(content) => {
                  const pendingCursor = pendingGenerateRef.current;
                  if (pendingCursor !== null) {
                    pendingGenerateRef.current = null;
                    const commandRange = findGenerateCommandRange(content, pendingCursor);
                    if (commandRange) {
                      const nextContent = stripCommandLine(content, commandRange);
                      applyContentUpdate(selectedNote.id, nextContent);
                      const insertIndex = commandRange.lineStart;
                      setSelection({ start: insertIndex, end: insertIndex });
                      selectionRef.current = { start: insertIndex, end: insertIndex };
                      const baseVersion = editVersionRef.current;
                      void runGenerate(insertIndex, nextContent, baseVersion);
                      return;
                    }
                  }
                  applyContentUpdate(selectedNote.id, content);
                }}
                onBlur={() => dismissCommandMenu(false)}
                onPressIn={() => {
                  if (commandState) dismissCommandMenu(true);
                }}
                onSelectionChange={(event) => {
                  const nextSelection = event.nativeEvent.selection;
                  setSelection(nextSelection);
                  selectionRef.current = nextSelection;
                }}
                onKeyPress={(event) => {
                  const key = event.nativeEvent.key;
                  if (key === "Escape") {
                    dismissCommandMenu(true);
                    return;
                  }
                  if (key === "Enter" || key === "Return") {
                    queueGenerateFromCommand();
                  }
                }}
                onScroll={(event) => {
                  const offset = event.nativeEvent.contentOffset.y;
                  scrollOffsetRef.current = offset;
                  if (!commandMeasureRef.current) return;
                  const line = commandMeasureRef.current;
                  setCommandAnchor({ x: line.x + line.width, y: line.y + line.height - offset });
                }}
                placeholder="Écris ta note…"
                placeholderTextColor={theme.colors.placeholder}
                multiline
                underlineColorAndroid="transparent"
                style={[styles.editorBody, webNoOutline]}
                textAlignVertical="top"
                selection={selection}
              />
              {commandState && visibleCommands.length > 0 && editorLayout.width > 0 ? (
                <>
                  <Text
                    style={[styles.editorBody, styles.editorBodyMeasure, { width: editorLayout.width }]}
                    onTextLayout={handleCommandMeasureLayout}
                  >
                    {draftContent.slice(0, commandState.end) || " "}
                  </Text>
                  {commandAnchor ? (
                    <View
                      style={[
                        styles.commandMenu,
                        {
                          width: Math.min(commandMenuWidth, Math.max(0, editorLayout.width - 16)),
                          left: (() => {
                            const menuWidth = Math.min(commandMenuWidth, Math.max(0, editorLayout.width - 16));
                            return clamp(commandAnchor.x + 8, 8, Math.max(8, editorLayout.width - menuWidth - 8));
                          })(),
                          top: (() => {
                            const menuHeight = commandMenuPadding * 2 + commandMenuRowHeight * visibleCommands.length;
                            if (editorLayout.height === 0) return Math.max(8, commandAnchor.y + 8);
                            const below = commandAnchor.y + 8;
                            const above = commandAnchor.y - menuHeight - 8;
                            const preferred = below + menuHeight > editorLayout.height && above > 8 ? above : below;
                            return clamp(preferred, 8, Math.max(8, editorLayout.height - menuHeight - 8));
                          })(),
                        },
                      ]}
                    >
                      {visibleCommands.map((command) => (
                        <Pressable
                          key={command.id}
                          onPress={() => applyCommand(command)}
                          style={({ pressed }) => [styles.commandItem, pressed && styles.commandItemPressed]}
                        >
                          <View style={styles.commandItemText}>
                            <Text style={styles.commandItemTitle}>{command.title}</Text>
                            <Text style={styles.commandItemDescription}>{command.description}</Text>
                          </View>
                          <Text style={styles.commandItemShortcut}>/{command.command}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          </View>
        )}
      </View>

      {isMobileLayout && isSidebarOpen ? <Pressable onPress={closeSidebar} style={styles.sidebarBackdrop} /> : null}
      {isMobileLayout && isSidebarOpen ? renderSidebar("drawer") : null}
    </View>
  );
}

function createStyles(theme: Theme) {
  const editorBodyColor = theme.name === "dark" ? "#e6e7ea" : "#111827";

  return StyleSheet.create({
    root: { flex: 1, flexDirection: "row", backgroundColor: theme.colors.background },

    sidebar: {
      width: sidebarWidth,
      backgroundColor: theme.colors.panel,
      borderRightWidth: 1,
      borderRightColor: theme.colors.border,
    },
    sidebarHeader: {
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sidebarHeaderLeft: { flex: 1, paddingRight: 10 },
    sidebarHeaderActions: { flexDirection: "row", alignItems: "center", gap: 8 },
    appTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "700", letterSpacing: 0.2 },
    userLabel: { color: theme.colors.textSubtle, fontSize: 12, marginTop: 2 },
    iconButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.buttonMuted },
    iconButtonText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "800" },

    searchWrap: {
      flexDirection: "row",
      alignItems: "center",
      marginHorizontal: 12,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: theme.colors.borderSubtle,
      backgroundColor: theme.colors.panelMuted,
      borderRadius: 10,
      height: 40,
    },
    searchIcon: { color: theme.colors.placeholder, marginRight: 8, fontSize: 16 },
    searchInput: { flex: 1, color: theme.colors.text, fontSize: 14 },

    navSection: { marginTop: 10, paddingHorizontal: 8 },
    navItem: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 10, borderRadius: 8 },
    navIcon: { color: theme.colors.textMuted, width: 22, fontSize: 14 },
    navLabel: { color: theme.colors.text, fontSize: 14 },

    sectionHeader: {
      marginTop: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    sectionHeaderText: { color: theme.colors.textMuted, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 },
    newButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.buttonMuted },
    newButtonText: { color: theme.colors.text, fontSize: 12, fontWeight: "600" },

    notesListContent: { paddingHorizontal: 8, paddingBottom: 12 },
    noteRow: {
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 10,
      marginBottom: 6,
      backgroundColor: "transparent",
    },
    noteRowSelected: { backgroundColor: theme.colors.button },
    noteRowText: { gap: 2 },
    noteTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
    noteMeta: { color: theme.colors.textMuted, fontSize: 12 },

    main: { flex: 1, paddingHorizontal: 28, paddingTop: 22 },
    mainWide: { paddingHorizontal: 52 },
    mobileHeader: { marginBottom: 12, alignItems: "flex-start" },
    editorWrap: { flex: 1 },
    editorHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
    },
    editorBodyWrap: { flex: 1, position: "relative" },
    editorTitle: {
      color: theme.colors.text,
      fontSize: 38,
      fontWeight: "800",
      paddingVertical: 6,
    },
    editorTitleInput: { flex: 1, minWidth: 0 },
    saveStatusBanner: {
      alignSelf: "flex-start",
      backgroundColor: theme.colors.panelMuted,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    saveStatusText: { color: theme.colors.textSubtle, fontSize: 12, fontWeight: "600" },
    editorBody: { flex: 1, color: editorBodyColor, fontSize: 16, lineHeight: 22, paddingVertical: 6 },
    editorBodyMeasure: {
      position: "absolute",
      opacity: 0,
      left: 0,
      top: 0,
      pointerEvents: "none",
    },

    emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "700" },
    emptySubtitle: { color: theme.colors.textMuted, fontSize: 14, marginTop: 8 },
    cta: { marginTop: 18, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.colors.button },
    ctaText: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },

    sidebarLoading: { paddingTop: 18 },

    pressed: { opacity: 0.8 },

    commandMenu: {
      position: "absolute",
      backgroundColor: theme.colors.panel,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingVertical: commandMenuPadding,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      elevation: 12,
      zIndex: 10,
    },
    commandItem: {
      minHeight: commandMenuRowHeight,
      paddingHorizontal: 12,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    commandItemPressed: { backgroundColor: theme.colors.buttonMuted, borderRadius: 10 },
    commandItemText: { flex: 1 },
    commandItemTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
    commandItemDescription: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
    commandItemShortcut: { color: theme.colors.textSubtle, fontSize: 12, fontWeight: "600" },

    sidebarBackdrop: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.name === "dark" ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.25)",
      zIndex: 50,
    },
    sidebarDrawer: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      zIndex: 60,
      elevation: 60,
    },
  });
}
