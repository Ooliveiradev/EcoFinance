import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';

export const NOTIFICATION_HANDLER_TASK = 'ECOFINANCE_NOTIFICATION_HANDLER';
// Older installations may launch this registered task before the first UI
// upgrade. Keep its identifier, but never inspect data, request GPS or send.
if (!TaskManager.isTaskDefined(NOTIFICATION_HANDLER_TASK)) {
  TaskManager.defineTask(NOTIFICATION_HANDLER_TASK, async () => {});
}
export async function disableLegacyCapture() {
  if (await TaskManager.isTaskRegisteredAsync(NOTIFICATION_HANDLER_TASK)) {
    await Notifications.unregisterTaskAsync(NOTIFICATION_HANDLER_TASK);
  }
}
