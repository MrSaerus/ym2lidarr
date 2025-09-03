import type { AppProps } from 'next/app';
import { ConfigProvider } from '../components/ConfigProvider';
import '../styles/globals.css';
import Toaster from '../components/Toaster';
// ОБЯЗАТЕЛЬНО: подключаем общий Tailwind/CSS
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
    return (
      <>
        <ConfigProvider>
          <Toaster />
          <Component {...pageProps} />
        </ConfigProvider>
      </>
    );
}
