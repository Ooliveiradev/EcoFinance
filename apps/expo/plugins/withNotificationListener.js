const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withNotificationListener(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const application = androidManifest.manifest.application[0];

    const service = {
      $: {
        'android:name': 'com.lesimoes.androidnotificationlistener.RNAndroidNotificationListenerService',
        'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
        'android:exported': 'false',
      },
      'intent-filter': [
        {
          action: [
            {
              $: {
                'android:name': 'android.service.notification.NotificationListenerService',
              },
            },
          ],
        },
      ],
    };

    if (!application.service) {
      application.service = [];
    }

    // Check if service already exists to avoid duplicates
    const exists = application.service.some(
      (s) => s.$['android:name'] === service.$['android:name']
    );

    if (!exists) {
      application.service.push(service);
    }

    return config;
  });
};
