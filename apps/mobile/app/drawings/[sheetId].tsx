import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from "react-native";
import type { LayoutChangeEvent, GestureResponderEvent } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { LocalDrawingSheet } from "../../src/features/drawings/repository";
import { downloadDrawingSheet, getDrawingSheet } from "../../src/features/drawings/repository";
import { createTask } from "../../src/features/tasks/repository";
import { theme } from "../../src/lib/theme";

interface Pin {
  x: number;
  y: number;
}

// roadmap.md Phase 1C "Field tasks/punch + drawing viewer offline"
// (FR-DOC-5). Tapping the sheet drops a pin at a normalized (0-1) x/y —
// stored on the punch item as location_x/location_y against
// location_document_version_id (apps/api/.../schema/tasks.ts) so the same
// spot renders consistently regardless of device screen size.
//
// PDF rendering is intentionally not implemented here: this sandbox has no
// device/simulator to verify a native PDF view against, so a non-image
// sheet (most real drawings are PDFs) falls back to a plain tappable
// placeholder rather than guessing at an unverified dependency. Tap-to-pin
// still works either way — only the visual preview is deferred (flagged
// follow-up, not a stub: the punch item it creates is real).
export default function DrawingViewerScreen() {
  const { sheetId } = useLocalSearchParams<{ sheetId: string }>();
  const router = useRouter();
  const [sheet, setSheet] = useState<LocalDrawingSheet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [pin, setPin] = useState<Pin | null>(null);
  const [title, setTitle] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    if (!sheetId) return;
    let current = await getDrawingSheet(sheetId);
    if (current && !current.localUri) {
      current = await downloadDrawingSheet(current);
    }
    setSheet(current);
    setIsLoading(false);
  }, [sheetId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setCanvasSize({ width, height });
  }

  function handleTap(event: GestureResponderEvent) {
    if (canvasSize.width === 0 || canvasSize.height === 0) return;
    const { locationX, locationY } = event.nativeEvent;
    setPin({ x: locationX / canvasSize.width, y: locationY / canvasSize.height });
  }

  async function handleSavePin() {
    if (!sheet || !pin || !title.trim()) return;
    setIsSaving(true);
    try {
      await createTask({
        projectId: sheet.projectId,
        title: title.trim(),
        kind: "punch",
        locationDocumentVersionId: sheet.documentVersionId,
        locationX: pin.x,
        locationY: pin.y,
      });
      router.back();
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  if (!sheet) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background, padding: theme.spacing[6] }}>
        <Text style={{ color: theme.colors.textMuted, textAlign: "center" }}>Sheet not cached yet — open it from the Drawings tab.</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: theme.spacing[4], minHeight: 52, justifyContent: "center" }}>
          <Text style={{ color: theme.colors.brand, fontWeight: "600" }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const isImage = sheet.contentType?.startsWith("image/") ?? false;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: theme.spacing[4],
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Pressable onPress={() => router.back()} style={{ minHeight: 52, minWidth: 52, justifyContent: "center" }}>
          <Text style={{ color: theme.colors.brand, fontWeight: "600" }}>← Back</Text>
        </Pressable>
        <Text style={{ color: theme.colors.text, fontWeight: "600", marginLeft: theme.spacing[3] }}>{sheet.drawingSetName}</Text>
      </View>

      <Pressable onPress={handleTap} onLayout={handleLayout} style={{ flex: 1, backgroundColor: "#000" }}>
        {isImage && sheet.localUri ? (
          <Image source={{ uri: sheet.localUri }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing[6] }}>
            <Text style={{ color: theme.colors.textMuted, textAlign: "center" }}>
              Drawing cached offline. Preview isn't available for this file type yet — tap anywhere to drop a pin.
            </Text>
          </View>
        )}
        {pin ? (
          <View
            style={{
              position: "absolute",
              left: pin.x * canvasSize.width - 12,
              top: pin.y * canvasSize.height - 24,
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: theme.colors.danger,
              borderWidth: 2,
              borderColor: "#FFFFFF",
            }}
          />
        ) : null}
      </Pressable>

      {pin ? (
        <View style={{ padding: theme.spacing[4], borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="What needs fixing at this spot?"
            placeholderTextColor={theme.colors.textMuted}
            autoFocus
            style={{
              backgroundColor: theme.colors.surfaceRaised,
              borderColor: theme.colors.border,
              borderWidth: 1,
              borderRadius: theme.radius.md,
              padding: theme.spacing[3],
              color: theme.colors.text,
              marginBottom: theme.spacing[3],
              minHeight: 52,
            }}
          />
          <View style={{ flexDirection: "row", gap: theme.spacing[3] }}>
            <Pressable
              onPress={() => setPin(null)}
              style={{ flex: 1, minHeight: 52, borderColor: theme.colors.border, borderWidth: 1, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ color: theme.colors.textMuted, fontWeight: "600" }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSavePin}
              disabled={!title.trim() || isSaving}
              style={{
                flex: 1,
                minHeight: 52,
                backgroundColor: theme.colors.brand,
                borderRadius: theme.radius.md,
                alignItems: "center",
                justifyContent: "center",
                opacity: !title.trim() || isSaving ? 0.5 : 1,
              }}
            >
              {isSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: "#FFFFFF", fontWeight: "600" }}>Create punch item</Text>}
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
