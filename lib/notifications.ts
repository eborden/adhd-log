import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import type { EventSubscription } from 'expo-modules-core';
import type * as Notifications from 'expo-notifications';
import type { Profile, Session, TimeOfDay } from './types';

type NotificationsModule = typeof Notifications;

// expo-notifications throws at *import* time on Android inside Expo Go
// (push functionality was removed from Expo Go in SDK 53) — a static
// top-level import would crash the whole app there. Loading it lazily,
// only when safe, keeps the rest of the app usable in Expo Go. Matches
// the exact check expo-notifications itself uses internally.
const NOTIFICATIONS_UNAVAILABLE = Platform.OS === 'android' && isRunningInExpoGo();

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (NOTIFICATIONS_UNAVAILABLE) return null;
  return import('expo-notifications');
}

const NOTIFICATION_IDS = {
  morning: 'adhd-log-morning-reminder',
  evening: 'adhd-log-evening-reminder',
} as const;

export async function configureNotificationHandler(): Promise<void> {
  const notifications = await loadNotifications();
  if (notifications === null) return;
  notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
  });
}

export async function requestNotificationPermissions(): Promise<boolean> {
  const notifications = await loadNotifications();
  if (notifications === null) return false;
  const existing = await notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const requested = await notifications.requestPermissionsAsync();
  return requested.granted;
}

async function scheduleDaily(
  notifications: NotificationsModule,
  identifier: string,
  session: Session,
  time: TimeOfDay,
  title: string,
  body: string,
): Promise<void> {
  await notifications.cancelScheduledNotificationAsync(identifier);
  await notifications.scheduleNotificationAsync({
    identifier,
    content: { title, body, data: { session } },
    trigger: {
      type: notifications.SchedulableTriggerInputTypes.DAILY,
      hour: time.hour,
      minute: time.minute,
    },
  });
}

export async function scheduleReminders(profile: Profile): Promise<void> {
  const notifications = await loadNotifications();
  if (notifications === null) return;
  await scheduleDaily(
    notifications,
    NOTIFICATION_IDS.morning,
    'morning',
    profile.morningReminder,
    'Morning check-in',
    "Quick check-in: dose, sleep, and how you're feeling.",
  );
  await scheduleDaily(
    notifications,
    NOTIFICATION_IDS.evening,
    'evening',
    profile.eveningReminder,
    'Evening check-in',
    'Take a minute to log today before you wind down.',
  );
}

export async function cancelReminders(): Promise<void> {
  const notifications = await loadNotifications();
  if (notifications === null) return;
  await notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.morning);
  await notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.evening);
}

function isSession(value: unknown): value is Session {
  return value === 'morning' || value === 'evening';
}

/** Extracts which check-in session a tapped notification should deep-link to. */
export function sessionFromResponse(response: Notifications.NotificationResponse): Session | null {
  const data = response.notification.request.content.data;
  const session = data?.['session'];
  return isSession(session) ? session : null;
}

export async function addNotificationTapListener(
  onTap: (session: Session) => void,
): Promise<EventSubscription | null> {
  const notifications = await loadNotifications();
  if (notifications === null) return null;
  return notifications.addNotificationResponseReceivedListener((response) => {
    const session = sessionFromResponse(response);
    if (session !== null) onTap(session);
  });
}
