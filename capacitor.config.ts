import type { CapacitorConfig } from '@capacitor/cli'

/**
 * APK natif pointant sur l'app deployee, meme principe que BubuCloud : un
 * deploiement Vercel met a jour le telephone sans reconstruire l'APK.
 *
 * La WebView charge directement l'URL de production, donc l'origine de la
 * page est celle du domaine Vercel : la session Supabase, le service worker
 * et les URL signees fonctionnent exactement comme dans le navigateur.
 *
 * Reconstruire l'APK n'est necessaire que pour l'icone, le nom, l'identifiant
 * du paquet, ce fichier, ou un changement de cle de signature.
 */
const config: CapacitorConfig = {
  appId: 'com.creationation.bubutravel',
  appName: 'BuBuTravel',
  webDir: 'dist',
  server: {
    url: 'https://bubu-travel.vercel.app',
    cleartext: false,
    androidScheme: 'https',
    // La navigation reste sur le domaine de l'app, le reste part dans le
    // navigateur du telephone.
    allowNavigation: ['bubu-travel.vercel.app'],
  },
  android: {
    adjustMarginsForEdgeToEdge: 'disable',
  },
}

export default config
