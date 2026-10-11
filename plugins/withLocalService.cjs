const { withAndroidManifest } = require('expo/config-plugins');
module.exports = config => withAndroidManifest(config, result => {
  // The optional PC service uses HTTP on loopback/private LAN. The client validates the address.
  result.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
  return result;
});
