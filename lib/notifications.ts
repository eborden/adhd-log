import * as Notifications from 'expo-notifications';
import type { EventSubscription } from 'expo-modules-core';
import type { Profile, Session, TimeOfDay } from './types';

const NOTIFICATION_IDS = {
  morning: 'adhd-log-morning-reminder',
  evening: 'adhd-log-evening-reminder',
} as const;

export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
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
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

async function scheduleDaily(
  identifier: string,
  session: Session,
  time: TimeOfDay,
  title: string,
  body: string,
): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(identifier);
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: { title, body, data: { session } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: time.hour,
      minute: time.minute,
    },
  });
}

export async function scheduleReminders(profile: Profile): Promise<void> {
  await scheduleDaily(
    NOTIFICATION_IDS.morning,
    'morning',
    profile.morningReminder,
    'Morning check-in',
    "Quick check-in: dose, sleep, and how you're feeling.",
  );
  await scheduleDaily(
    NOTIFICATION_IDS.evening,
    'evening',
    profile.eveningReminder,
    'Evening check-in',
    'Take a minute to log today before you wind down.',
  );
}

export async function cancelReminders(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.morning);
  await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_IDS.evening);
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

export function addNotificationTapListener(onTap: (session: Session) => void): EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const session = sessionFromResponse(response);
    if (session !== null) onTap(session);
  });
}
