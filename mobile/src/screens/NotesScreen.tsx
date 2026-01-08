import type { Session } from "@supabase/supabase-js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";

import * as api from "../lib/api";
import type { Theme } from "../lib/theme";
import { Note } from "../types/note";
import { formatSidebarTimestamp } from "../utils/dates";

function nowIso(): string {
  return new Date().toISOString();
}

const sidebarWidth = 310;

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

  const editVersionRef = useRef(0);
  const saveAbortRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const styles = useMemo(() => createStyles(theme), [theme]);
  const titlePlaceholderColor = theme.name === "dark" ? "#9aa0a6" : "#cbd5e1";
  const displayTitle = draftTitle === "Sans titre" || draftTitle === "Nouvelle note" ? "" : draftTitle;

  const selectedNote = useMemo(() => notes.find((n) => n.id === selectedNoteId) ?? null, [notes, selectedNoteId]);

  function selectNote(note: Note) {
    setSelectedNoteId(note.id);
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setIsDirty(false);
    setSaveError(null);
  }

  function patchNoteLocal(noteId: string, patch: Partial<Note>) {
    setNotes((prev) => {
      const next = prev.map((note) => (note.id === noteId ? { ...note, ...patch } : note));
      next.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      return next;
    });
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
                  patchNoteLocal(selectedNote.id, { title, updated_at: nowIso() });
                }}
                placeholder="Nouvelle page"
                placeholderTextColor={titlePlaceholderColor}
                underlineColorAndroid="transparent"
                style={[styles.editorTitle, styles.editorTitleInput, webNoOutline]}
              />
              <View style={styles.saveStatusBanner}>
                <Text style={styles.saveStatusText} numberOfLines={1}>
                  {saveError ? saveError : isSaving ? "Enregistrement…" : isDirty ? "Modifications non enregistrées" : "Synchronisé"}
                </Text>
              </View>
            </View>
            <TextInput
              value={draftContent}
              onChangeText={(content) => {
                editVersionRef.current += 1;
                setDraftContent(content);
                setIsDirty(true);
                patchNoteLocal(selectedNote.id, { content, updated_at: nowIso() });
              }}
              placeholder="Écris ta note…"
              placeholderTextColor={theme.colors.placeholder}
              multiline
              underlineColorAndroid="transparent"
              style={[styles.editorBody, webNoOutline]}
              textAlignVertical="top"
            />
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

    emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "700" },
    emptySubtitle: { color: theme.colors.textMuted, fontSize: 14, marginTop: 8 },
    cta: { marginTop: 18, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.colors.button },
    ctaText: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },

    sidebarLoading: { paddingTop: 18 },

    pressed: { opacity: 0.8 },

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
