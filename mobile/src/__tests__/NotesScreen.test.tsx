/// <reference types="jest" />
import React from "react";
import renderer, { act } from "react-test-renderer";
import type { Session } from "@supabase/supabase-js";

import { NotesScreen } from "../screens/NotesScreen";
import { themes } from "../lib/theme";
import * as api from "../lib/api";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: 1200, height: 800, scale: 1, fontScale: 1 }),
}));

jest.mock("react-native/Libraries/Lists/FlatList", () => {
  const React = require("react");
  const { View } = require("react-native");
  const MockFlatList = (props: {
    data?: unknown[];
    renderItem: (info: { item: any; index: number }) => React.ReactElement | null;
    keyExtractor?: (item: any, index: number) => string;
    contentContainerStyle?: unknown;
  }) => {
    const { data = [], renderItem, keyExtractor, contentContainerStyle } = props;
    return (
      <View style={contentContainerStyle}>
        {data.map((item, index) => (
          <React.Fragment key={keyExtractor ? keyExtractor(item, index) : item.id ?? index}>
            {renderItem({ item, index })}
          </React.Fragment>
        ))}
      </View>
    );
  };
  return { __esModule: true, default: MockFlatList };
});

jest.mock("../lib/api", () => ({
  listNotes: jest.fn(),
  createNote: jest.fn(),
  updateNote: jest.fn(),
  deleteNote: jest.fn(),
  generateContinuationStream: jest.fn(),
  generateContinuation: jest.fn(),
}));

const mockedApi = api as jest.Mocked<typeof api>;

const session = {
  access_token: "token",
  user: { id: "user-1", email: "user@example.com" },
} as Session;

const baseProps = {
  session,
  onSignOut: jest.fn(),
  onToggleTheme: jest.fn(),
  theme: themes.light,
};

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("NotesScreen delete", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("removes a note after successful deletion", async () => {
    mockedApi.listNotes.mockResolvedValueOnce([
      {
        id: "note-1",
        title: "Note A",
        content: "",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
      {
        id: "note-2",
        title: "Note B",
        content: "",
        created_at: "2024-01-03T00:00:00Z",
        updated_at: "2024-01-04T00:00:00Z",
      },
    ]);
    mockedApi.deleteNote.mockResolvedValueOnce();

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<NotesScreen {...baseProps} />);
      await flushPromises();
    });

    const deleteButton = tree!.root.findByProps({ testID: "notes-list-delete-note-2" });

    await act(async () => {
      deleteButton.props.onPress();
      await flushPromises();
    });

    expect(mockedApi.deleteNote).toHaveBeenCalledWith("token", "note-2");
    expect(tree!.root.findAllByProps({ testID: "notes-list-delete-note-2" }).length).toBe(0);
    expect(tree!.root.findAllByProps({ testID: "notes-list-delete-note-1" }).length).toBeGreaterThan(0);
  });

  it("keeps the note and shows an error when deletion fails", async () => {
    mockedApi.listNotes.mockResolvedValueOnce([
      {
        id: "note-1",
        title: "Note A",
        content: "",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      },
    ]);
    mockedApi.deleteNote.mockRejectedValueOnce(new Error("Suppression impossible"));

    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<NotesScreen {...baseProps} />);
      await flushPromises();
    });

    const deleteButton = tree!.root.findByProps({ testID: "notes-list-delete-note-1" });

    await act(async () => {
      deleteButton.props.onPress();
      await flushPromises();
    });

    expect(mockedApi.deleteNote).toHaveBeenCalledWith("token", "note-1");
    expect(tree!.root.findAllByProps({ testID: "notes-list-delete-note-1" }).length).toBeGreaterThan(0);
    expect(tree!.root.findByProps({ testID: "notes-delete-error" }).props.children).toBe("Suppression impossible");
  });
});
