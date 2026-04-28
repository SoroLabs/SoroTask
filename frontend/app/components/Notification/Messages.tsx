import { useState } from "react";
import {
  notificationTypeColors,
  notificationTypeIcons,
} from "./exampleNotification/example";

interface messageProp {
  id: string;
  type: keyof typeof notificationTypeIcons;
  title: string;
  message: string;
  timeAgo: string;
  read: boolean;
  isFullPage: boolean;
  setRead: (id: string) => void;
}

export default function Message({
  id,
  type,
  title,
  message,
  timeAgo,
  read,
  isFullPage,
  setRead,
}: messageProp) {
  const [isOpen, setIsOpen] = useState(false);
  const Icon = notificationTypeIcons[type];
  const color = notificationTypeColors[type] || "#000000";
  return (
    <>
      <div className="cursor-pointer w-full">
        <div className="flex gap-5 ">
          {Icon ? (
            <Icon size={30} color={color} />
          ) : (
            <div className="w-[30px]" />
          )}
          <div className="w-full">
            <div className="flex justify-between items-center">
              <div
                onClick={() => {
                  setIsOpen(true);
                  setRead(id);
                }}
                className="w-full"
              >
                <h2
                  className={`${read ? "text-[#667589]" : isFullPage ? "text-white" : "text-black"} font-bold`}
                >
                  {title}
                </h2>
                <p className="text-sm text-[#667589]">
                  {message.slice(0, 30)} ...
                </p>
              </div>
              {isFullPage && (
                <button className="bg-[#00c389] px-2 py-1 rounded-md">
                  Delete
                </button>
              )}
            </div>

            <div className="flex justify-between w-full">
              <div
                className={`${!read ? "bg-[#00c389]" : ""} rounded-md mb-1 px-2`}
              >
                <p className="font-bold">{read ? "" : "New"}</p>
              </div>
              <p className="text-sm text-[#667589]">{timeAgo}</p>
            </div>
          </div>
        </div>
      </div>
      {isOpen && (
        <div
          className={`fixed ${isFullPage ? "w-[90%] lg:w-[40%] h-auto min-h-[40%]  bg-white left-[50%] translate-x-[-50%] top-[5%]" : "w-full h-full  bg-white left-0 top-0"}`}
        >
          <div className="flex justify-end p-4">
            <div
              onClick={() => {
                setIsOpen(false);
              }}
              className="bg-red-500 rounded-full text-white w-7 h-7 flex items-center justify-center cursor-default"
            >
              <h1>X</h1>
            </div>
          </div>
          <div className="flex flex-col justify-between items-center py-5">
            <div className=" px-2 flex w-full flex-col gap-5 mt-5 max-h-[330px] min-h-[330px] overflow-y-auto break-all">
              <h2 className="text-black font-bold text-xl">{title}</h2>

              <p className="mt-5 text-[#667589]">{message}</p>
            </div>
            <div>
              <button className="bg-[#121a2a] p-2 rounded-md">
                go to context page{" "}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
