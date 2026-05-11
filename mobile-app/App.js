import { StatusBar } from 'expo-status-bar'
import Constants from 'expo-constants'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'

const WEB_APP_URL_RAW =
  Constants.expoConfig?.extra?.webAppUrl || 'https://your-deployed-web-app-url.com'
/** Bump this in app.json every time you deploy the *web* app so the WebView URL changes and cannot reuse old JS. */
const WEB_APP_CACHE_KEY = Constants.expoConfig?.extra?.webAppCacheKey ?? '1'

function webViewUri(base, cacheKey) {
  const trimmed = String(base).trim().replace(/\/+$/, '')
  if (!trimmed) return 'https://your-deployed-web-app-url.com'
  const joiner = trimmed.includes('?') ? '&' : '?'
  return `${trimmed}${joiner}app_cache=${encodeURIComponent(String(cacheKey))}`
}

const WEB_VIEW_URI = webViewUri(WEB_APP_URL_RAW, WEB_APP_CACHE_KEY)

export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <WebView
        source={{ uri: WEB_VIEW_URI }}
        /* Old bundles still render Leaflet popups for pins; new code uses a portal. */
        cacheEnabled={false}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color="#2563eb" />
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff'
  },
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
