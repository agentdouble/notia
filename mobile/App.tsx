import "react-native-url-polyfill/auto";

import { StatusBar } from "expo-status-bar";
import type { Session } from "@supabase/supabase-js";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabase } from "./src/lib/supabase";
import { AuthScreen } from "./src/screens/AuthScreen";
import { NotesScreen } from "./src/screens/NotesScreen";
import { ThemeName, themes } from "./src/lib/theme";

const themeStorageKey = "agentdouble:theme";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [themeName, setThemeName] = useState<ThemeName>("dark");
  const [isThemeReady, setIsThemeReady] = useState(false);

  const theme = themes[themeName];

  function toggleTheme() {
    setThemeName((prev) => (prev === "dark" ? "light" : "dark"));
  }

  useEffect(() => {
    let isMounted = true;
    AsyncStorage.getItem(themeStorageKey)
      .then((value) => {
        if (!isMounted) return;
        if (value === "light" || value === "dark") setThemeName(value);
      })
      .catch((e) => {
        console.warn("Failed to load theme preference.", e);
      })
      .finally(() => {
        if (!isMounted) return;
        setIsThemeReady(true);
      });

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!isMounted) return;
        setSession(data.session);
      })
      .finally(() => {
        if (!isMounted) return;
        setIsBooting(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isThemeReady) return;
    AsyncStorage.setItem(themeStorageKey, themeName).catch((e) => {
      console.warn("Failed to persist theme preference.", e);
    });
  }, [isThemeReady, themeName]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
      <StatusBar style={theme.statusBarStyle} />
      {isBooting || !isThemeReady ? (
        <View style={styles.boot}>
          <ActivityIndicator />
        </View>
      ) : session ? (
        <NotesScreen session={session} onSignOut={() => supabase.auth.signOut()} theme={theme} onToggleTheme={toggleTheme} />
      ) : (
        <AuthScreen theme={theme} onToggleTheme={toggleTheme} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  boot: { flex: 1, alignItems: "center", justifyContent: "center" },
});
