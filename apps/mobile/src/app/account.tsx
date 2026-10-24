import { ROLE_LABELS } from '@ambarci/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import type { JSX } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useOrganizations } from '@/api/organization-provider';
import { useAuth } from '@/auth/auth-provider';
import { AppText } from '@/components/app-text';
import { Button, Card } from '@/components/ui';
import { colors, radius, spacing, touchTarget } from '@/theme';

/** Hesap: giriş yapan kullanıcı, aktif şirket seçimi (birden fazla şirket varsa), ses denemesi ve çıkış. */
export default function AccountScreen(): JSX.Element {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const { organizations, active, selectOrganization } = useOrganizations();
  const [pending, setPending] = useState(false);

  async function handleSignOut(): Promise<void> {
    setPending(true);
    await signOut();
    // Çıkıştan sonra giriş ekranına geçişi _layout.tsx'teki korumalı yığın yapar.
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card style={styles.gap}>
        <AppText variant="labelSm" tone="muted">
          GİRİŞ YAPAN
        </AppText>
        <AppText variant="bodyLgBold">{session?.user.email ?? '—'}</AppText>
        {active ? (
          <AppText tone="muted">
            {active.name} • {ROLE_LABELS[active.role]}
          </AppText>
        ) : null}
      </Card>

      {organizations.length > 1 ? (
        <View style={styles.gap}>
          <AppText variant="labelSm" tone="muted">
            ŞİRKET
          </AppText>
          {organizations.map((organization) => {
            const selected = organization.id === active?.id;
            return (
              <Pressable
                key={organization.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => {
                  selectOrganization(organization.id);
                  router.back();
                }}
                style={[styles.option, selected ? styles.optionSelected : null]}
              >
                <AppText variant="bodyLgBold" tone={selected ? 'primary' : 'text'} style={styles.flex}>
                  {organization.name}
                </AppText>
                <AppText tone="muted">{ROLE_LABELS[organization.role]}</AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Geçici: ses tanıma denemesi 4–5. haftada sohbet ekranına taşınınca kaldırılacak. */}
      <Button label="Ses tanıma denemesi" variant="secondary" onPress={() => router.push('/speech-test')} />
      <Button
        label={pending ? 'Çıkış yapılıyor…' : 'Çıkış yap'}
        variant="secondary"
        disabled={pending}
        onPress={() => void handleSignOut()}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    gap: spacing.md,
  },
  gap: {
    gap: spacing.sm,
  },
  option: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  flex: {
    flex: 1,
  },
});
