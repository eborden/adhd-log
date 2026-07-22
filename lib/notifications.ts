import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import type { EventSubscription } from 'expo-modules-core';
import type * as Notifications from 'expo-notifications';
import { isSession } from './storage';
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
  weekly: 'adhd-log-weekly',
} as const;

// expo-notifications weekdays: 1 = Sunday, so Monday is 2.
const MONDAY_WEEKDAY = 2;

// Android (API 26+) drops any notification not tied to a channel — the fallback
// "Miscellaneous" channel expo-notifications auto-creates is low-importance, so
// scheduled reminders arrive silently or get suppressed by OEM battery managers.
// We create our own high-importance channel and attach it to every scheduled
// trigger so reminders actually surface. No-op on iOS.
const ANDROID_CHANNEL_ID = 'adhd-log-reminders';

async function ensureAndroidChannel(notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Check-in reminders',
    importance: notifications.AndroidImportance.HIGH,
  });
}

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
  await ensureAndroidChannel(notifications);
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
      channelId: ANDROID_CHANNEL_ID,
    },
  });
}

async function scheduleWeekly(notifications: NotificationsModule, time: TimeOfDay): Promise<void> {
  await notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.weekly);
  await notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_IDS.weekly,
    content: {
      title: 'Weekly check-in',
      body: 'How was last week overall?',
      data: { kind: 'weekly' },
    },
    trigger: {
      type: notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: MONDAY_WEEKDAY,
      hour: time.hour,
      minute: time.minute,
      channelId: ANDROID_CHANNEL_ID,
    },
  });
}

export async function scheduleReminders(profile: Profile): Promise<void> {
  const notifications = await loadNotifications();
  if (notifications === null) return;
  await ensureAndroidChannel(notifications);
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
  if (profile.weeklyReminder !== undefined) {
    await scheduleWeekly(notifications, profile.weeklyReminder);
  } else {
    await notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.weekly);
  }
}

/** Extracts which check-in session a tapped notification should deep-link to. */
export function sessionFromResponse(response: Notifications.NotificationResponse): Session | null {
  const data = response.notification.request.content.data;
  const session = data?.['session'];
  return isSession(session) ? session : null;
}

function isWeeklyNotificationKind(value: unknown): value is 'weekly' {
  return value === 'weekly';
}

/** Whether a tapped notification is the weekly reminder, so the tap listener can route to it. */
export function notificationKindFromResponse(
  response: Notifications.NotificationResponse,
): 'weekly' | null {
  const data = response.notification.request.content.data;
  const kind = data?.['kind'];
  return isWeeklyNotificationKind(kind) ? 'weekly' : null;
}

export async function addNotificationTapListener(
  onSessionTap: (session: Session) => void,
  onWeeklyTap: () => void,
): Promise<EventSubscription | null> {
  const notifications = await loadNotifications();
  if (notifications === null) return null;
  return notifications.addNotificationResponseReceivedListener((response) => {
    if (notificationKindFromResponse(response) === 'weekly') {
      onWeeklyTap();
      return;
    }
    const session = sessionFromResponse(response);
    if (session !== null) onSessionTap(session);
  });
}
