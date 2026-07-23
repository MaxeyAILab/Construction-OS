import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { LocalDrawingSheet, WorkingSetDrawingSet } from "../../src/features/drawings/repository";
import { downloadDrawingSheet, listCachedDrawingProjectIds, listDrawingSheets, upsertDrawingSet } from "../../src/features/drawings/repository";
import { apiRequest } from "../../src/lib/api";
import { useAuth } from "../../src/lib/auth";
import { useTheme } from "../../src/lib/theme";

interface WorkingSetProject {
  id: string;
  name: string;
  drawingSet: WorkingSetDrawingSet | null;
}

// roadmap.md Phase 1C "Field tasks/punch + drawing viewer offline"
// (FR-DOC-5). Mirrors the field's single currently-published drawing set
// (GET /sync/working-set) into SQLite so sheets stay viewable once
// downloaded, with no connectivity required afterward — same "network is
// an optimization" split as the rest of the field app (architecture.md §6).
export default function DrawingsScreen() {
  const { session } = useAuth();
  const { theme } = useTheme();
  const router = useRouter();
  const [sheets, setSheets] = useState<LocalDrawingSheet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    let projectId: string | null = null;
    try {
      if (!session) throw new Error("no session");
      const workingSet = await apiRequest<{ projects: WorkingSetProject[] }>("/sync/working-set", {
        token: session.accessToken,
      });
      const current = workingSet.projects[0] ?? null;
      if (current) {
        projectId = current.id;
        await upsertDrawingSet(current.id, current.drawingSet);
      }
    } catch {
      // Offline — fall back to whichever project's sheets are already
      // cached from a prior successful pull, so the viewer keeps working
      // without connectivity rather than going blank.
      const cachedIds = await listCachedDrawingProjectIds();
      projectId = cachedIds[0] ?? null;
    }

    setSheets(projectId ? await listDrawingSheets(projectId) : []);
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      load().finally(() => setIsLoading(false));
    }, [load]),
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await load();
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleDownload(sheet: LocalDrawingSheet) {
    setDownloadingId(sheet.documentVersionId);
    try {
      const updated = await downloadDrawingSheet(sheet);
      setSheets((prev) => prev.map((s) => (s.documentVersionId === updated.documentVersionId ? updated : s)));
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleOpen(sheet: LocalDrawingSheet) {
    if (!sheet.localUri) await handleDownload(sheet);
    router.push(`/drawings/${sheet.documentVersionId}`);
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ padding: theme.spacing[4], borderBottomWidth: theme.borderWidth, borderBottomColor: theme.colors.border }}>
        <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "600" }}>
          {sheets[0]?.drawingSetName ?? "Drawings"}
        </Text>
      </View>

      <FlatList
        data={sheets}
        keyExtractor={(item) => item.documentVersionId}
        contentContainerStyle={{ padding: theme.spacing[4] }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={theme.colors.brand} />}
        ListEmptyComponent={
          <Text style={{ color: theme.colors.textMuted, textAlign: "center", marginTop: theme.spacing[8] }}>
            No published drawing set for this project yet.
          </Text>
        }
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => handleOpen(item)}
            style={{
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderWidth: theme.borderWidth,
              borderRadius: theme.radius.md,
              padding: theme.spacing[4],
              marginBottom: theme.spacing[3],
              minHeight: theme.minTouchTarget,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ color: theme.colors.text, fontWeight: "600" }}>Sheet {index + 1}</Text>
            {downloadingId === item.documentVersionId ? (
              <ActivityIndicator color={theme.colors.brand} />
            ) : (
              <Text style={{ color: item.localUri ? theme.colors.success : theme.colors.textMuted }}>
                {item.localUri ? "Downloaded" : "Tap to download"}
              </Text>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}
