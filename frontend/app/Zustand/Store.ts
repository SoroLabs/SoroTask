import { getNotifications } from "../components/Notification/exampleNotification/example";
import { create } from "zustand";
const n = getNotifications();

type notificationsType = {
  notification: typeof n;
  setNotification: (value: typeof n) => void;
};

export const useNotification = create<notificationsType>((set) => ({
  notification: n,
  setNotification: (value: typeof n) =>
    set((state) => ({ notification: value })),
}));
