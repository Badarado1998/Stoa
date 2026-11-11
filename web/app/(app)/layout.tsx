import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Backdrop from "@/components/Backdrop";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Backdrop />
      <Header />
      <main id="app">
        {children}
        <Footer />
      </main>
    </>
  );
}
