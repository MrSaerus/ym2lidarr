import type { AppProps } from 'next/app';
import Script from 'next/script';
import { ConfigProvider } from '../components/ConfigProvider';
import Toaster from '../components/Toaster';
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Script src="/config.js" strategy="afterInteractive" />
      <ConfigProvider>
        <Toaster />
        <Component {...pageProps} />
      </ConfigProvider>
    </>
  );
}