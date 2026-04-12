import type { AppProps } from 'next/app';
import Script from 'next/script';
import Toaster from '../components/Toaster';
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Script src="/config.js" strategy="beforeInteractive" />
      <Toaster />
      <Component {...pageProps} />
    </>
  );
}