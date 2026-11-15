import { ClerkProvider } from "@clerk/nextjs";
import { type AppType } from "next/app";
import Head from "next/head";
import { api } from "~/utils/api";
import "~/styles/globals.css";

const MyApp: AppType = ({ Component, pageProps }) => (
  <ClerkProvider {...pageProps}>
    <Head>
      <title>Gather — Community chat</title>
    </Head>
    <Component {...pageProps} />
  </ClerkProvider>
);

export default api.withTRPC(MyApp);
