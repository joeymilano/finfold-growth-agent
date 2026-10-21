"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { Locale } from "@/lib/i18n";

export function LandingHeroVideo({ locale }: { locale: Locale }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loopFading, setLoopFading] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotionAllowed(!preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const backdrop = backdropRef.current;
    if (!video || !backdrop || !motionAllowed || failed) return;
    let inView = true;
    let active = true;
    function syncPlayback() {
      if (!video) return;
      if (paused || !inView || document.visibilityState === "hidden") {
        video.pause();
      } else {
        void video.play().catch(error => {
          if (active && inView && document.visibilityState !== "hidden" && error?.name !== "AbortError") setPaused(true);
        });
      }
    }
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      syncPlayback();
    });
    observer.observe(backdrop);
    document.addEventListener("visibilitychange", syncPlayback);
    syncPlayback();
    return () => {
      active = false;
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncPlayback);
      video.pause();
    };
  }, [motionAllowed, paused, failed]);

  return <>
    <div ref={backdropRef} aria-hidden="true" className="workspace-hero-atmosphere" data-video-ready={loaded && motionAllowed && !failed ? "true" : "false"}>
      {/* The still remains visible if autoplay, decoding, or motion is unavailable. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/media/hero-atmosphere-poster.jpg" alt="" className="workspace-hero-film" />
      <video
        ref={videoRef}
        src={motionAllowed && !failed ? "/media/hero-atmosphere.mp4" : undefined}
        muted playsInline loop autoPlay={motionAllowed && !paused} preload="none"
        className={`workspace-hero-film workspace-hero-video ${loaded && !failed ? "is-loaded" : ""} ${loopFading && !paused ? "is-fading" : ""}`}
        onLoadedData={() => setLoaded(true)}
        onTimeUpdate={event => {
          const video = event.currentTarget;
          setLoopFading(Number.isFinite(video.duration) && video.duration > 0 && video.duration - video.currentTime <= .55);
        }}
        onError={() => setFailed(true)}
      />
    </div>
    {motionAllowed && !failed ? <button
      type="button"
      onClick={() => setPaused(value => !value)}
      className="workspace-hero-motion focus-ring"
      aria-label={paused ? locale === "en" ? "Play background video" : "播放背景视频" : locale === "en" ? "Pause background video" : "暂停背景视频"}
      aria-pressed={paused}
    >{paused ? <Play aria-hidden className="h-3.5 w-3.5" /> : <Pause aria-hidden className="h-3.5 w-3.5" />}</button> : null}
  </>;
}
