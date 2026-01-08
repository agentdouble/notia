import React, { useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { supabase } from "../lib/supabase";
import type { Theme } from "../lib/theme";

type Mode = "sign_in" | "sign_up";

const webNoOutline = Platform.OS === "web" ? ({ outlineStyle: "none", outlineWidth: 0, boxShadow: "none" } as any) : undefined;
const webCursorPointer = Platform.OS === "web" ? ({ cursor: "pointer" } as any) : undefined;

export function AuthScreen({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [mode, setMode] = useState<Mode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const styles = useMemo(() => createStyles(theme), [theme]);

  const primaryLabel = useMemo(() => (mode === "sign_in" ? "Se connecter" : "Créer un compte"), [mode]);
  const secondaryLabel = useMemo(
    () => (mode === "sign_in" ? "Créer un compte" : "J’ai déjà un compte"),
    [mode]
  );

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      const trimmedEmail = email.trim();
      if (!trimmedEmail) throw new Error("Email requis.");
      if (!password) throw new Error("Mot de passe requis.");

      const { error: authError } =
        mode === "sign_in"
          ? await supabase.auth.signInWithPassword({ email: trimmedEmail, password })
          : await supabase.auth.signUp({ email: trimmedEmail, password });

      if (authError) throw authError;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erreur inconnue.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>agentdouble</Text>
          <Pressable onPress={onToggleTheme} style={({ pressed }) => [styles.iconButton, webCursorPointer, pressed && styles.pressed]}>
            <Text style={styles.iconButtonText}>{theme.name === "dark" ? "☀︎" : "☾"}</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>Notes minimalistes. Noir & blanc.</Text>

        <View style={styles.form}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Email"
            placeholderTextColor={theme.colors.placeholder}
            underlineColorAndroid="transparent"
            style={[styles.input, webNoOutline]}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Mot de passe"
            placeholderTextColor={theme.colors.placeholder}
            underlineColorAndroid="transparent"
            style={[styles.input, webNoOutline]}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            onPress={handleSubmit}
            disabled={loading}
            style={({ pressed }) => [styles.primaryButton, webCursorPointer, pressed && styles.pressed, loading && styles.disabled]}
          >
            {loading ? <ActivityIndicator /> : <Text style={styles.primaryButtonText}>{primaryLabel}</Text>}
          </Pressable>

          <Pressable
            onPress={() => setMode((prev) => (prev === "sign_in" ? "sign_up" : "sign_in"))}
            style={({ pressed }) => [styles.secondaryButton, webCursorPointer, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>{secondaryLabel}</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles(theme: Theme) {
  return StyleSheet.create({
    root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: theme.colors.background },
    card: {
      width: "100%",
      maxWidth: 420,
      padding: 20,
      borderRadius: 14,
      backgroundColor: theme.colors.panel,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { color: theme.colors.text, fontSize: 28, fontWeight: "800" },
    subtitle: { color: theme.colors.textMuted, fontSize: 14, marginTop: 6 },

    form: { marginTop: 18, gap: 10 },
    input: {
      height: 44,
      borderRadius: 10,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: theme.colors.borderSubtle,
      backgroundColor: theme.colors.panelMuted,
      color: theme.colors.text,
      fontSize: 14,
    },
    error: { color: theme.colors.error, fontSize: 13 },

    primaryButton: { height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.button },
    primaryButtonText: { color: theme.colors.text, fontSize: 14, fontWeight: "800" },

    secondaryButton: { height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    secondaryButtonText: { color: theme.colors.textMuted, fontSize: 14, fontWeight: "700" },

    iconButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: theme.colors.buttonMuted },
    iconButtonText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "800" },

    disabled: { opacity: 0.6 },
    pressed: { opacity: 0.85 },
  });
}
