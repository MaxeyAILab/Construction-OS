import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import { ApiError } from "../../src/lib/api";
import { useAuth } from "../../src/lib/auth";
import { theme } from "../../src/lib/theme";

export default function LoginScreen() {
  const { session, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Redirect href="/" />;

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await login({ email: email.trim(), password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to sign in. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, justifyContent: "center", padding: theme.spacing[6] }}>
      <Text style={{ color: theme.colors.text, fontSize: 28, fontWeight: "600", marginBottom: theme.spacing[8] }}>
        ConstructionOS
      </Text>

      <Text style={{ color: theme.colors.textMuted, marginBottom: theme.spacing[2] }}>Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="you@company.com"
        placeholderTextColor={theme.colors.textMuted}
        style={{
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: theme.radius.md,
          padding: theme.spacing[4],
          color: theme.colors.text,
          marginBottom: theme.spacing[4],
        }}
      />

      <Text style={{ color: theme.colors.textMuted, marginBottom: theme.spacing[2] }}>Password</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        placeholder="••••••••"
        placeholderTextColor={theme.colors.textMuted}
        style={{
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: theme.radius.md,
          padding: theme.spacing[4],
          color: theme.colors.text,
          marginBottom: theme.spacing[4],
        }}
      />

      {error ? <Text style={{ color: theme.colors.danger, marginBottom: theme.spacing[4] }}>{error}</Text> : null}

      <Pressable
        onPress={handleSubmit}
        disabled={isSubmitting || !email || !password}
        style={{
          backgroundColor: theme.colors.brand,
          borderRadius: theme.radius.md,
          padding: theme.spacing[4],
          alignItems: "center",
          opacity: isSubmitting || !email || !password ? 0.6 : 1,
        }}
      >
        {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: "#FFFFFF", fontWeight: "600" }}>Sign in</Text>}
      </Pressable>
    </View>
  );
}
