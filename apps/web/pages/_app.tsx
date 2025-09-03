import type { AppProps } from 'next/app';
import Script from 'next/script';
import { ConfigProvider } from '../components/ConfigProvider';
import '../styles/globals.css';
import Toaster from '../components/Toaster';
// ОБЯЗАТЕЛЬНО: подключаем общий Tailwind/CSS
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
    return (
      <>
        <ConfigProvider>
          <Script src="/config.js" strategy="beforeInteractive" />
          <Toaster />
          <Component {...pageProps} />
        </ConfigProvider>
      </>
    );
}
