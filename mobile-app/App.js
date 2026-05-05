import { StatusBar } from 'expo-status-bar'
import Constants from 'expo-constants'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'

const WEB_APP_URL =
  Constants.expoConfig?.extra?.webAppUrl || 'https://your-deployed-web-app-url.com'

export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <WebView
        source={{ uri: WEB_APP_URL }}
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
