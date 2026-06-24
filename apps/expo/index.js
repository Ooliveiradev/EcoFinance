import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import App from './src/App';
import { headlessNotificationListener } from './src/services/notification-handler';

// Register the headless task for notification listening
AppRegistry.registerHeadlessTask(
  'RNAndroidNotificationListenerHeadlessJs',
  () => headlessNotificationListener
);

registerRootComponent(App);
