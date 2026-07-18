import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import type { ColorValue } from 'react-native';
import { space, typography, useTheme } from '../../lib/theme';

function TabIcon({
  name,
  color,
}: {
  readonly name: keyof typeof Ionicons.glyphMap;
  readonly color: ColorValue;
}) {
  return <Ionicons name={name} size={24} color={color} />;
}

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingTop: space.sm,
        },
        tabBarLabelStyle: typography.caption,
        headerStyle: { backgroundColor: theme.surface },
        headerShadowVisible: false,
        headerTitleStyle: typography.cardTitle,
        headerTintColor: theme.text,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => <TabIcon name="today-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="trends"
        options={{
          title: 'Trends',
          tabBarIcon: ({ color }) => <TabIcon name="trending-up-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color }) => <TabIcon name="time-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabIcon name="settings-outline" color={color} />,
        }}
      />
    </Tabs>
  );
}
