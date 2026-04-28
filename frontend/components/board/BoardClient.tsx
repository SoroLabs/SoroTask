"use client"

import dynamic from "next/dynamic"

const Board = dynamic(() => import("./Board"), {
  ssr: false,
})

export default function BoardClient() {
  return <Board />
}