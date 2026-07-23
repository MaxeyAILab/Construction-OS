import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import type { LocalDailyReport, LocalTimeEntry } from "../../src/features/field/repository";
import {
  createDailyReport,
  createTimeEntry,
  getReportForDate,
  listTimeEntriesForReport,
  updateDailyReport,
} from "../../src/features/field/repository";
import type { QueuedPhoto } from "../../src/features/photos/repository";
import { capturePhoto, listQueuedPhotos } from "../../src/features/photos/repository";
import { apiRequest } from "../../src/lib/api";
import { useAuth } from "../../src/lib/auth";
import { theme } from "../../src/lib/theme";

interface WorkingSetProject {
  id: string;
  name: string;
}

interface CostCode {
  id: string;
  code: string;
  name: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// FR-FIELD-1: "report filing < 2 min" (persona Marco). v1 assumes a single
// active project per field worker — the working set's first assigned
// project — rather than a project picker; multi-project crews are a
// follow-up (same scope-narrowing flagged for the Projects tab's live
// fetch, this just goes one step further and picks one automatically).
export default function ReportScreen() {
  const { session } = useAuth();
  const [project, setProject] = useState<WorkingSetProject | null>(null);
  const [report, setReport] = useState<LocalDailyReport | null>(null);
  const [narrative, setNarrative] = useState("");
  const [conditions, setConditions] = useState("");
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [selectedCostCodeId, setSelectedCostCodeId] = useState<string | null>(null);
  const [hoursInput, setHoursInput] = useState("");
  const [timeEntries, setTimeEntries] = useState<LocalTimeEntry[]>([]);
  const [photos, setPhotos] = useState<QueuedPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setIsLoading(true);
    try {
      const workingSet = await apiRequest<{ projects: WorkingSetProject[] }>("/sync/working-set", {
        token: session.accessToken,
      });
      const current = workingSet.projects[0] ?? null;
      setProject(current);
      if (!current) return;

      let existing = await getReportForDate(current.id, today());
      if (!existing) existing = await createDailyReport(current.id, today());
      setReport(existing);
      setNarrative(existing.narrative ?? "");
      setConditions(existing.weather?.conditions ?? "");

      const entries = await listTimeEntriesForReport(existing.id);
      setTimeEntries(entries);

      const queuedPhotos = await listQueuedPhotos("daily_report", existing.id);
      setPhotos(queuedPhotos);

      const codes = await apiRequest<CostCode[]>(`/projects/${current.id}/cost-codes`, { token: session.accessToken });
      setCostCodes(codes);
      setSelectedCostCodeId((prev) => prev ?? codes[0]?.id ?? null);
    } catch {
      // Offline on first-ever open (no local report cached yet) — nothing
      // to show until connectivity returns; local-first writes below still
      // work once a report exists.
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleSaveDraft() {
    if (!report) return;
    setIsSaving(true);
    try {
      await updateDailyReport(report, { narrative, weather: { conditions } });
      setReport({ ...report, narrative, weather: { conditions } });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSubmit() {
    if (!report) return;
    setIsSaving(true);
    try {
      await updateDailyReport(report, { narrative, weather: { conditions }, status: "submitted" });
      setReport({ ...report, narrative, weather: { conditions }, status: "submitted" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLogHours() {
    if (!report || !project || !session || !selectedCostCodeId) return;
    const hours = Number.parseFloat(hoursInput);
    if (!Number.isFinite(hours) || hours <= 0) return;

    const entry = await createTimeEntry({
      dailyReportId: report.id,
      projectId: project.id,
      userId: session.userId,
      costCodeId: selectedCostCodeId,
      hours,
      workDate: today(),
    });
    setTimeEntries((prev) => [entry, ...prev]);
    setHoursInput("");
  }

  // FR-FIELD-3: geo-/time-stamped, captured straight to local storage —
  // the actual upload happens opportunistically from photo_queue (see
  // src/lib/photo-upload.ts), never blocking the capture itself.
  async function handleCapturePhoto() {
    if (!report || !project) return;
    setIsCapturing(true);
    try {
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      if (!cameraPermission.granted) return;

      const result = await ImagePicker.launchCameraAsync({ quality: 0.7, exif: false });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0]!;

      const info = await FileSystem.getInfoAsync(asset.uri);
      if (!info.exists) return;

      let geoLat: number | undefined;
      let geoLng: number | undefined;
      let heading: number | undefined;
      const locationPermission = await Location.requestForegroundPermissionsAsync();
      if (locationPermission.granted) {
        const position = await Location.getCurrentPositionAsync({});
        geoLat = position.coords.latitude;
        geoLng = position.coords.longitude;
        heading = position.coords.heading ?? undefined;
      }

      const queued = await capturePhoto({
        localUri: asset.uri,
        contentType: asset.mimeType ?? "image/jpeg",
        sizeBytes: info.size,
        projectId: project.id,
        entityType: "daily_report",
        entityId: report.id,
        geoLat,
        geoLng,
        heading,
      });
      setPhotos((prev) => [queued, ...prev]);
    } finally {
      setIsCapturing(false);
    }
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  if (!project || !report) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background, padding: theme.spacing[6] }}>
        <Text style={{ color: theme.colors.textMuted, textAlign: "center" }}>
          No assigned project yet — connect once to load your working set.
        </Text>
      </View>
    );
  }

  const isSubmitted = report.status === "submitted";

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: theme.spacing[4] }}>
      <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: "600" }}>{project.name}</Text>
      <Text style={{ color: theme.colors.textMuted, marginTop: theme.spacing[1], marginBottom: theme.spacing[4] }}>
        Daily report · {today()} · {isSubmitted ? "Submitted" : "Draft"}
      </Text>

      <Text style={{ color: theme.colors.textMuted, marginBottom: theme.spacing[2] }}>Weather</Text>
      <TextInput
        value={conditions}
        onChangeText={setConditions}
        editable={!isSubmitted}
        placeholder="Clear, 75°F, light wind"
        placeholderTextColor={theme.colors.textMuted}
        style={{
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: theme.radius.md,
          padding: theme.spacing[3],
          color: theme.colors.text,
          marginBottom: theme.spacing[4],
        }}
      />

      <Text style={{ color: theme.colors.textMuted, marginBottom: theme.spacing[2] }}>Narrative</Text>
      <TextInput
        value={narrative}
        onChangeText={setNarrative}
        editable={!isSubmitted}
        multiline
        numberOfLines={5}
        placeholder="What happened today — labor, materials, equipment, progress..."
        placeholderTextColor={theme.colors.textMuted}
        style={{
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: theme.radius.md,
          padding: theme.spacing[3],
          color: theme.colors.text,
          minHeight: 120,
          textAlignVertical: "top",
          marginBottom: theme.spacing[4],
        }}
      />

      {!isSubmitted ? (
        <View style={{ flexDirection: "row", gap: theme.spacing[3], marginBottom: theme.spacing[6] }}>
          <Pressable
            onPress={handleSaveDraft}
            disabled={isSaving}
            style={{
              flex: 1,
              borderColor: theme.colors.brand,
              borderWidth: 1,
              borderRadius: theme.radius.md,
              padding: theme.spacing[3],
              alignItems: "center",
              opacity: isSaving ? 0.6 : 1,
            }}
          >
            <Text style={{ color: theme.colors.brand, fontWeight: "600" }}>Save draft</Text>
          </Pressable>
          <Pressable
            onPress={handleSubmit}
            disabled={isSaving}
            style={{
              flex: 1,
              backgroundColor: theme.colors.brand,
              borderRadius: theme.radius.md,
              padding: theme.spacing[3],
              alignItems: "center",
              opacity: isSaving ? 0.6 : 1,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "600" }}>Submit</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "600", marginBottom: theme.spacing[3] }}>My hours today</Text>

      {costCodes.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: theme.spacing[3] }}>
          {costCodes.map((code) => {
            const isSelected = code.id === selectedCostCodeId;
            return (
              <Pressable
                key={code.id}
                onPress={() => setSelectedCostCodeId(code.id)}
                style={{
                  borderColor: isSelected ? theme.colors.brand : theme.colors.border,
                  borderWidth: 1,
                  borderRadius: theme.radius.sm,
                  paddingVertical: theme.spacing[2],
                  paddingHorizontal: theme.spacing[3],
                  marginRight: theme.spacing[2],
                  backgroundColor: isSelected ? theme.colors.surfaceRaised : "transparent",
                }}
              >
                <Text style={{ color: isSelected ? theme.colors.brand : theme.colors.textMuted }}>{code.code}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={{ flexDirection: "row", gap: theme.spacing[3], marginBottom: theme.spacing[4] }}>
        <TextInput
          value={hoursInput}
          onChangeText={setHoursInput}
          keyboardType="decimal-pad"
          placeholder="Hours"
          placeholderTextColor={theme.colors.textMuted}
          style={{
            flex: 1,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderWidth: 1,
            borderRadius: theme.radius.md,
            padding: theme.spacing[3],
            color: theme.colors.text,
          }}
        />
        <Pressable
          onPress={handleLogHours}
          disabled={!selectedCostCodeId || !hoursInput}
          style={{
            borderColor: theme.colors.success,
            borderWidth: 1,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing[4],
            alignItems: "center",
            justifyContent: "center",
            opacity: !selectedCostCodeId || !hoursInput ? 0.5 : 1,
          }}
        >
          <Text style={{ color: theme.colors.success, fontWeight: "600" }}>Log hours</Text>
        </Pressable>
      </View>

      {timeEntries.map((entry) => (
        <View
          key={entry.id}
          style={{
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderWidth: 1,
            borderRadius: theme.radius.md,
            padding: theme.spacing[3],
            marginBottom: theme.spacing[2],
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ color: theme.colors.text }}>{costCodes.find((c) => c.id === entry.costCodeId)?.code ?? entry.costCodeId}</Text>
          <Text style={{ color: theme.colors.textMuted }}>{entry.hours} hrs</Text>
        </View>
      ))}

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: theme.spacing[6], marginBottom: theme.spacing[3] }}>
        <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: "600" }}>Photos</Text>
        <Pressable
          onPress={handleCapturePhoto}
          disabled={isCapturing}
          style={{
            borderColor: theme.colors.brand,
            borderWidth: 1,
            borderRadius: theme.radius.sm,
            paddingVertical: theme.spacing[2],
            paddingHorizontal: theme.spacing[3],
            opacity: isCapturing ? 0.6 : 1,
          }}
        >
          {isCapturing ? <ActivityIndicator color={theme.colors.brand} /> : <Text style={{ color: theme.colors.brand, fontWeight: "600" }}>+ Add photo</Text>}
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] }}>
        {photos.map((photo) => (
          <View key={photo.id} style={{ width: 96, height: 96, borderRadius: theme.radius.sm, overflow: "hidden" }}>
            <Image source={{ uri: photo.localUri }} style={{ width: 96, height: 96 }} />
            {photo.status !== "uploaded" ? (
              <View
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  backgroundColor: "rgba(0,0,0,0.6)",
                  paddingVertical: 2,
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 10, textAlign: "center" }}>
                  {photo.status === "failed" ? "Failed" : "Pending"}
                </Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
