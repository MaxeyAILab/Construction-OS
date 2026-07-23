import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { LocalTask } from "../../src/features/tasks/repository";
import { createTask, listTasks, updateTask } from "../../src/features/tasks/repository";
import { apiRequest } from "../../src/lib/api";
import { useAuth } from "../../src/lib/auth";
import { syncNow } from "../../src/lib/sync";
import { theme } from "../../src/lib/theme";

interface WorkingSetProject {
  id: string;
  name: string;
}

const STATUS_COLOR: Record<LocalTask["status"], string> = {
  todo: theme.colors.textMuted,
  in_progress: theme.colors.brand,
  blocked: theme.colors.danger,
  done: theme.colors.success,
  cancelled: theme.colors.textMuted,
};

// roadmap.md Phase 1C "Field tasks/punch + drawing viewer offline"
// (FR-DOC-5). Punch items are tasks with kind='punch' — same entity, same
// sync engine, same tasks.ts schema as the Today tab's regular tasks (see
// apps/api/src/infrastructure/db/schema/tasks.ts's ck_tasks_kind check).
// A punch item created here has no drawing pin; tapping a spot in the
// drawing viewer (app/drawings/[sheetId].tsx) creates one with a pin via
// the same createTask() call.
export default function PunchScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const [project, setProject] = useState<WorkingSetProject | null>(null);
  const [items, setItems] = useState<LocalTask[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const reload = useCallback(async () => {
    const all = await listTasks();
    setItems(all.filter((t) => t.kind === "punch"));
  }, []);

  const loadProject = useCallback(async () => {
    if (!session) return;
    try {
      const workingSet = await apiRequest<{ projects: WorkingSetProject[] }>("/sync/working-set", {
        token: session.accessToken,
      });
      setProject(workingSet.projects[0] ?? null);
    } catch {
      // Offline: the list below still renders from SQLite; creating a new
      // punch item just waits until the working set is reachable again,
      // same "connect once" precedent as the Report tab.
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      reload();
      loadProject();
    }, [reload, loadProject]),
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      if (session) await syncNow(session);
      await loadProject();
    } catch {
      // offline — local list still renders
    } finally {
      await reload();
      setIsRefreshing(false);
    }
  }

  async function handleCreate() {
    if (!project || !title.trim()) return;
    const trimmedDescription = description.trim();
    await createTask({
      projectId: project.id,
      title: title.trim(),
      kind: "punch",
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
    });
    setTitle("");
    setDescription("");
    setIsCreating(false);
    await reload();
  }

  async function markDone(item: LocalTask) {
    await updateTask(item.id, { status: "done" });
    await reload();
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: theme.spacing[4],
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "600" }}>Punch list</Text>
        <Pressable
          onPress={() => router.push("/drawings")}
          style={{ borderColor: theme.colors.brand, borderWidth: 1, borderRadius: theme.radius.sm, paddingVertical: theme.spacing[2], paddingHorizontal: theme.spacing[3], minHeight: 52, justifyContent: "center" }}
        >
          <Text style={{ color: theme.colors.brand, fontWeight: "600" }}>Pin on drawing</Text>
        </Pressable>
      </View>

      {isCreating ? (
        <View style={{ padding: theme.spacing[4], borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="What needs fixing?"
            placeholderTextColor={theme.colors.textMuted}
            style={{
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderWidth: 1,
              borderRadius: theme.radius.md,
              padding: theme.spacing[3],
              color: theme.colors.text,
              marginBottom: theme.spacing[3],
              minHeight: 52,
            }}
          />
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Details (optional)"
            placeholderTextColor={theme.colors.textMuted}
            multiline
            style={{
              backgroundColor: theme.colors.surface,
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
              onPress={() => setIsCreating(false)}
              style={{ flex: 1, minHeight: 52, borderColor: theme.colors.border, borderWidth: 1, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ color: theme.colors.textMuted, fontWeight: "600" }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleCreate}
              disabled={!project || !title.trim()}
              style={{
                flex: 1,
                minHeight: 52,
                backgroundColor: theme.colors.brand,
                borderRadius: theme.radius.md,
                alignItems: "center",
                justifyContent: "center",
                opacity: !project || !title.trim() ? 0.5 : 1,
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "600" }}>Save</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => setIsCreating(true)}
          disabled={!project}
          style={{
            margin: theme.spacing[4],
            minHeight: 52,
            borderColor: theme.colors.brand,
            borderWidth: 1,
            borderRadius: theme.radius.md,
            alignItems: "center",
            justifyContent: "center",
            opacity: !project ? 0.5 : 1,
          }}
        >
          <Text style={{ color: theme.colors.brand, fontWeight: "600" }}>+ New punch item</Text>
        </Pressable>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: theme.spacing[4], paddingTop: 0 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={theme.colors.brand} />}
        ListEmptyComponent={
          <Text style={{ color: theme.colors.textMuted, textAlign: "center", marginTop: theme.spacing[8] }}>
            No punch items yet.
          </Text>
        }
        renderItem={({ item }) => (
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderWidth: 1,
              borderRadius: theme.radius.md,
              padding: theme.spacing[4],
              marginBottom: theme.spacing[3],
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <View style={{ flex: 1, marginRight: theme.spacing[3] }}>
              <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{item.title}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: theme.spacing[1] }}>
                <Text style={{ color: STATUS_COLOR[item.status] }}>{item.status.replace("_", " ")}</Text>
                {item.locationDocumentVersionId ? (
                  <Text style={{ color: theme.colors.textMuted, marginLeft: theme.spacing[2] }}>· 📍 pinned</Text>
                ) : null}
              </View>
            </View>
            {item.status !== "done" ? (
              <Pressable
                onPress={() => markDone(item)}
                style={{ minHeight: 52, minWidth: 52, borderColor: theme.colors.success, borderWidth: 1, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing[3], alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: theme.colors.success, fontWeight: "600" }}>Done</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}
