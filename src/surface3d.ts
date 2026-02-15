/* Copyright 2016 Google Inc. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/

import {Example2D} from "./dataset";
import * as d3 from "d3";

interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

interface SurfaceCell {
  points: ProjectedPoint[];
  depth: number;
  value: number;
}

const SURFACE_ALPHA = 0.42;
const GRID_ALPHA = 0.22;
const POINT_RADIUS = 2.6;
const MESH_STEP = 2;

export class SurfacePlot3D {
  private width: number;
  private height: number;
  private numSamples: number;
  private xDomain: [number, number];
  private yDomain: [number, number];
  private canvas;
  private context: CanvasRenderingContext2D;
  private devicePixelRatio: number;
  private color;
  private surfaceData: number[][] = null;
  private discretize = false;
  private trainPoints: Example2D[] = [];
  private testPoints: Example2D[] = [];
  private zMin = -1;
  private zMax = 1;
  private azimuth = -Math.PI / 4;
  private elevation = Math.PI / 5;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;
  private scale: number;

  constructor(
      width: number, numSamples: number, xDomain: [number, number],
      yDomain: [number, number], container) {
    this.width = width;
    this.height = width;
    this.numSamples = numSamples;
    this.xDomain = xDomain;
    this.yDomain = yDomain;
    this.scale = width * 0.34;

    this.color = d3.scale.linear<string, number>()
      .domain([-1, 0, 1])
      .range(["#f59322", "#e8eaeb", "#0877bd"])
      .clamp(true);

    let root = container.append("div")
      .attr("class", "surface-3d")
      .style({
        width: `${width}px`,
        height: `${this.height}px`,
        position: "relative"
      });

    this.canvas = root.append("canvas")
      .style("width", `${width}px`)
      .style("height", `${this.height}px`);

    this.devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
    let canvasNode = this.canvas.node() as HTMLCanvasElement;
    canvasNode.width = Math.floor(width * this.devicePixelRatio);
    canvasNode.height = Math.floor(this.height * this.devicePixelRatio);
    this.context = canvasNode.getContext("2d");
    this.context.setTransform(this.devicePixelRatio, 0, 0,
        this.devicePixelRatio, 0, 0);

    this.attachInteraction(canvasNode);
    this.render();
  }

  updatePoints(points: Example2D[]): void {
    this.trainPoints = this.filterPointsInDomain(points);
    this.updateZRange();
    this.render();
  }

  updateTestPoints(points: Example2D[]): void {
    this.testPoints = this.filterPointsInDomain(points);
    this.updateZRange();
    this.render();
  }

  updateBackground(data: number[][], discretize: boolean): void {
    let dx = data[0].length;
    let dy = data.length;
    if (dx !== this.numSamples || dy !== this.numSamples) {
      throw new Error(
          "The provided data matrix must be of size numSamples X numSamples");
    }
    this.surfaceData = data;
    this.discretize = discretize;
    this.updateZRange();
    this.render();
  }

  private attachInteraction(canvasNode: HTMLCanvasElement) {
    canvasNode.addEventListener("mousedown", (event: MouseEvent) => {
      this.dragging = true;
      this.dragX = event.clientX;
      this.dragY = event.clientY;
    });

    window.addEventListener("mouseup", () => {
      this.dragging = false;
    });

    window.addEventListener("mousemove", (event: MouseEvent) => {
      if (!this.dragging) {
        return;
      }
      let dx = event.clientX - this.dragX;
      let dy = event.clientY - this.dragY;
      this.dragX = event.clientX;
      this.dragY = event.clientY;
      this.azimuth += dx * 0.01;
      this.elevation -= dy * 0.01;
      this.elevation = Math.max(0.15, Math.min(1.3, this.elevation));
      this.render();
    });
  }

  private render() {
    if (this.context == null) {
      return;
    }
    let context = this.context;
    context.clearRect(0, 0, this.width, this.height);
    context.fillStyle = "#f7f7f7";
    context.fillRect(0, 0, this.width, this.height);

    if (this.surfaceData == null) {
      this.drawAxes();
      return;
    }

    this.drawSurface();
    this.drawAxes();
    this.drawPoints(this.trainPoints, false);
    this.drawPoints(this.testPoints, true);

    context.fillStyle = "rgba(70, 70, 70, 0.75)";
    context.font = "11px Helvetica, Arial, sans-serif";
    context.fillText("Drag to rotate", 8, this.height - 10);
  }

  private drawSurface() {
    let cells: SurfaceCell[] = [];
    let step = Math.max(1, MESH_STEP);
    for (let i = 0; i < this.numSamples - step; i += step) {
      for (let j = 0; j < this.numSamples - step; j += step) {
        let v00 = this.toDisplayValue(this.surfaceData[i][j]);
        let v10 = this.toDisplayValue(this.surfaceData[i + step][j]);
        let v11 = this.toDisplayValue(this.surfaceData[i + step][j + step]);
        let v01 = this.toDisplayValue(this.surfaceData[i][j + step]);
        let value = (v00 + v10 + v11 + v01) / 4;
        let p00 = this.gridPoint(i, j, v00);
        let p10 = this.gridPoint(i + step, j, v10);
        let p11 = this.gridPoint(i + step, j + step, v11);
        let p01 = this.gridPoint(i, j + step, v01);
        let depth = (p00.depth + p10.depth + p11.depth + p01.depth) / 4;
        cells.push({points: [p00, p10, p11, p01], depth, value});
      }
    }

    cells.sort((a, b) => a.depth - b.depth);

    let context = this.context;
    for (let i = 0; i < cells.length; i++) {
      let cell = cells[i];
      let c = d3.rgb(this.color(this.normalizeZ(cell.value)));
      context.beginPath();
      context.moveTo(cell.points[0].x, cell.points[0].y);
      context.lineTo(cell.points[1].x, cell.points[1].y);
      context.lineTo(cell.points[2].x, cell.points[2].y);
      context.lineTo(cell.points[3].x, cell.points[3].y);
      context.closePath();
      context.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${SURFACE_ALPHA})`;
      context.fill();
      context.strokeStyle = `rgba(255, 255, 255, ${GRID_ALPHA})`;
      context.lineWidth = 0.7;
      context.stroke();
    }
  }

  private drawAxes() {
    let origin = this.project(-1, -1, -1);
    let xAxisEnd = this.project(1.1, -1, -1);
    let yAxisEnd = this.project(-1, 1.1, -1);
    let zAxisEnd = this.project(-1, -1, 1.15);
    let context = this.context;

    this.drawAxisLine(origin, xAxisEnd, "#666");
    this.drawAxisLine(origin, yAxisEnd, "#666");
    this.drawAxisLine(origin, zAxisEnd, "#555");

    context.fillStyle = "#333";
    context.font = "12px Helvetica, Arial, sans-serif";
    context.fillText("x1", xAxisEnd.x + 4, xAxisEnd.y + 2);
    context.fillText("x2", yAxisEnd.x - 14, yAxisEnd.y + 2);
    context.fillText("y", zAxisEnd.x + 5, zAxisEnd.y - 2);
  }

  private drawAxisLine(start: ProjectedPoint, end: ProjectedPoint, color: string) {
    let context = this.context;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = color;
    context.lineWidth = 1.4;
    context.stroke();
  }

  private drawPoints(points: Example2D[], isTest: boolean) {
    let context = this.context;
    for (let i = 0; i < points.length; i++) {
      let point = points[i];
      let value = this.toDisplayValue(point.label);
      let projected = this.project(
          this.normalizeAxis(point.x, this.xDomain),
          this.normalizeAxis(point.y, this.yDomain),
          this.normalizeZ(value));
      let c = d3.rgb(this.color(this.normalizeZ(value)));
      context.beginPath();
      context.arc(projected.x, projected.y, POINT_RADIUS, 0, Math.PI * 2);
      if (isTest) {
        context.fillStyle = "rgba(255, 255, 255, 0.95)";
        context.fill();
        context.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, 1)`;
        context.lineWidth = 1.3;
        context.stroke();
      } else {
        context.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, 0.95)`;
        context.fill();
        context.strokeStyle = "rgba(20, 20, 20, 0.55)";
        context.lineWidth = 0.7;
        context.stroke();
      }
    }
  }

  private gridPoint(i: number, j: number, value: number): ProjectedPoint {
    let xT = i / (this.numSamples - 1);
    let yT = j / (this.numSamples - 1);
    let x = this.xDomain[0] + xT * (this.xDomain[1] - this.xDomain[0]);
    let y = this.yDomain[1] - yT * (this.yDomain[1] - this.yDomain[0]);
    return this.project(
      this.normalizeAxis(x, this.xDomain),
      this.normalizeAxis(y, this.yDomain),
      this.normalizeZ(value));
  }

  private normalizeAxis(value: number, domain: [number, number]): number {
    let min = domain[0];
    let max = domain[1];
    if (max === min) {
      return 0;
    }
    return ((value - min) / (max - min)) * 2 - 1;
  }

  private normalizeZ(value: number): number {
    let min = this.zMin;
    let max = this.zMax;
    if (max === min) {
      return 0;
    }
    let clamped = Math.max(min, Math.min(max, value));
    return ((clamped - min) / (max - min)) * 2 - 1;
  }

  private project(x: number, y: number, z: number): ProjectedPoint {
    let cosA = Math.cos(this.azimuth);
    let sinA = Math.sin(this.azimuth);
    let x1 = x * cosA - y * sinA;
    let y1 = x * sinA + y * cosA;

    let cosE = Math.cos(this.elevation);
    let sinE = Math.sin(this.elevation);
    let y2 = y1 * cosE - z * sinE;
    let z2 = y1 * sinE + z * cosE;

    let cameraDistance = 4;
    let perspective = cameraDistance / (cameraDistance - z2);

    return {
      x: this.width * 0.5 + x1 * this.scale * perspective,
      y: this.height * 0.62 - y2 * this.scale * perspective,
      depth: z2
    };
  }

  private toDisplayValue(value: number): number {
    if (!this.discretize) {
      return value;
    }
    return value >= 0 ? 1 : -1;
  }

  private updateZRange() {
    if (this.surfaceData == null) {
      return;
    }
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < this.surfaceData.length; i++) {
      for (let j = 0; j < this.surfaceData[i].length; j++) {
        let value = this.toDisplayValue(this.surfaceData[i][j]);
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }

    let allPoints = this.trainPoints.concat(this.testPoints);
    for (let i = 0; i < allPoints.length; i++) {
      let value = this.toDisplayValue(allPoints[i].label);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }

    if (!isFinite(min) || !isFinite(max)) {
      min = -1;
      max = 1;
    }
    if (Math.abs(max - min) < 1e-6) {
      min -= 1;
      max += 1;
    }

    let pad = (max - min) * 0.08;
    this.zMin = min - pad;
    this.zMax = max + pad;
  }

  private filterPointsInDomain(points: Example2D[]): Example2D[] {
    let xMin = this.xDomain[0];
    let xMax = this.xDomain[1];
    let yMin = this.yDomain[0];
    let yMax = this.yDomain[1];
    return points.filter(point => {
      return point.x >= xMin && point.x <= xMax &&
          point.y >= yMin && point.y <= yMax;
    });
  }
}
