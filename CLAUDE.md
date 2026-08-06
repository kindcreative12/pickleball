# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

The repository is empty apart from this file. No code has been written yet — the first session's job is to scaffold it. The decisions below were made deliberately before any code existed; treat them as the baseline and don't re-litigate them unless the user says otherwise.

## What this is

An online multiplayer pickleball game — real-time, browser-based, so the user and their friends can play together over the internet by opening a link. Playability is the goal, not polish.

## Agreed design decisions

**Stack — web.** TypeScript throughout. Client renders to HTML5 Canvas; server is Node.js speaking WebSockets. Chosen so friends join via a URL with nothing to install. Deploy target is a small always-on host (Fly.io / Railway / similar) since a persistent WebSocket server is required — a purely static/serverless host won't work for the game server.

**Perspective — top-down 2D.** Bird's-eye view of the court, closer to air hockey than to a side-view tennis game. Consequence: the ball needs an explicit height (`z`) in its state even though the camera is top-down, because bounces and the net matter in pickleball. Render height as a shadow whose offset/size tracks `z`.

**Player count — 1v1 first, 2v2 later.** Build singles as the core loop (movement, paddle contact, ball physics, scoring). But rooms must hold a variable list of players per side rather than hardcoding two total, so doubles drops in later without reworking the netcode.

## Architecture guidance

Server-authoritative. The server owns the simulation and is the single source of truth for ball and player state; clients send input intent, not positions. This is the constraint that keeps the game fair and prevents divergence between players — don't let physics drift into client-only code.

Expect a shared module for anything both sides must agree on: court dimensions, physics constants, the tick rate, and the message/state types. Duplicating these between client and server is the most likely source of subtle desync bugs.

Pickleball's rules that actually affect the code: the two-bounce rule (each side must let the serve and return bounce before volleying), the non-volley zone ("the kitchen") near the net, and underhand serves. These shape scoring and legal-hit logic, so decide how faithfully to model them early rather than retrofitting.
