import { NotificationPreferenceCenter } from "../src/components/notification-preference-center";

export default function Home() {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <NotificationPreferenceCenter />
      </div>
    </main>
  );
}
