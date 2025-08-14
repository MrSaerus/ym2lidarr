import type { AppProps } from 'next/app';

// ОБЯЗАТЕЛЬНО: подключаем общий Tailwind/CSS
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
    return <Component {...pageProps} />;
}
