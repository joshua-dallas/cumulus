import { CloudBuilder } from "./lib/cloud-builder.js";
import { EtchRenderer } from "./lib/etch-render.js";

// TODO: Watch for changes to attributes and re-render the cloud when they change
// TODO: Implement pixel perfect resizing of the canvas when the element is resized
// TODO: Sunset colour mode (animate the shadow diag)

export class Cumulus extends HTMLElement {
  connectedCallback() {
    // Only create the shadow root and canvas if they haven't been created yet
    if (this.shadowRoot) return;

    const width = Number(this.getAttribute("width")) || 500;
    const height = Number(this.getAttribute("height")) || 500;
    const numCells = Number(this.getAttribute("numCells")) || 10;
    const seed = Number(this.getAttribute("seed")) || 314; // TODO: randomize seed if not provided 312 is good
    const lineWidth = Number(this.getAttribute("lineWidth")) || 1;
    const lineSpacing = Number(this.getAttribute("lineWidth")) || 2;

    // Initialise the cloud builder and generate the starting cells
    this.cloudBuilder = new CloudBuilder(width, height, numCells, seed);
    /*console.log(
      "Generated cells:",
      JSON.stringify(this.cloudBuilder.cells, null, 2),
    );*/

    const shadow = this.attachShadow({ mode: "open" });
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d");
    if (!this.context) return;

    this.canvas.style.height = `${height}px`;
    this.canvas.style.width = `${width}px`;
    this.canvas.width = width; // TODO; do these help?
    this.canvas.height = height;
    shadow.append(this.canvas);

    // Set up the renderer
    this.renderer = new EtchRenderer(this.canvas, lineWidth, lineSpacing);
    // Define the shade colours
    // TODO: Define as consts outside of connectedCallback
    this.renderer.colours.background = { hue: 206, sat: 57, light: 60 };
    this.renderer.colours.light = { hue: 0, sat: 0, light: 100 };
    this.renderer.colours.mid = { hue: 0, sat: 0, light: 75 };
    this.renderer.colours.dark = { hue: 0, sat: 0, light: 50 };
    this.renderer.colours.dark2 = { hue: 0, sat: 0, light: 15 };
    this.renderer.setBackgroundBorderNoise(3);
    this.renderer.finaliseRenderer();

    this.drawFrame();

    //this.renderer.setBackgroundPadding()
    //this.renderer.setBackgroundMask()
    //this.renderer.setBackgroundBoxNoise({leftVert, rightVert, topHor, bottomHor})
    //this.renderer.setLineWidth()
    //this.renderer.setLineSpacing()
    //this.renderer.setWaves/WaveMap()
    //this.renderer.setLineEndShape() // flat, rounded
    //this.renderer.setBorderLinesEndShape() // tapered, rounded, noise on length, occassional dot at the end
    //this.renderer.addLayer(json)

    //this.renderer.renderCells(this.cloudBuilder.cells);
    //this.renderer.renderCells(this.cloudBuilder.fillCircles);
    //this.renderer.renderPolygon(this.cloudBuilder.cloudInnerRight);
    //this.renderer.renderPolygon(this.cloudBuilder.cloudInnerLeft);

    /*
    // Draw the dome and border for testing


    // Draw the dome
    context.beginPath();
    context.arc(
      this.cloudBuilder.dome.x,
      this.cloudBuilder.dome.y,
      this.cloudBuilder.dome.radius,
      Math.PI,
      2 * Math.PI,
    );
    context.strokeStyle = "grey";
    context.lineWidth = 1;
    context.stroke();

    // Draw the border around the canvas
    context.strokeRect(0, 0, width, height);

    // Draw the centreline
    context.beginPath();
    context.moveTo(
      this.cloudBuilder.dome.x,
      this.cloudBuilder.dome.y - this.cloudBuilder.dome.radius,
    );
    context.lineTo(this.cloudBuilder.dome.x, this.cloudBuilder.dome.y);
    context.stroke();*/

    // Animation
    requestAnimationFrame(this.createNextFrame.bind(this));
  }

  createNextFrame(timestamp) {
    // Clear the canvas
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Save the current config. TODO: Might not be needed
    // this.context.save();
    //const dpr = window.devicePixelRatio;
    //this.context.scale(dpr, dpr);

    // Simulate and draw the next frame
    this.cloudBuilder.simulateNextFrame(timestamp);
    this.renderer.clear();
    this.drawFrame();

    //this.context.restore();

    requestAnimationFrame(this.createNextFrame.bind(this));
  }

  drawFrame() {
    // Add the layers
    this.addFillCircleLayers(this.cloudBuilder.fillCircles);
    this.addCloudInnerLeftLayer(this.cloudBuilder.cloudInnerLeft);
    this.addCloudInnerRightLayer(this.cloudBuilder.cloudInnerRight);
    this.addCloudCellLayers(this.cloudBuilder.cells);

    this.renderer.draw();
  }

  addCloudCellLayer(cell) {
    // Add the main cell first
    this.renderer.addCircleLayer({
      x: cell.x,
      y: cell.y,
      radius: cell.radius,
      fill: this.renderer.colours.dark,
      rightEdgeNoise: 4, // Plus or minus this many pixels
      leftEdgeNoise: 7,
      rightPadding: 3, // TODO: Try without
      leftPadding: 0,
      lineWidth: 1.3,
      specialType: "cloud-cell",
      waveAmplitude: 0.6,
      wavePeriod: 30,
    });

    // Then add all its associated fractal circles
    const linkedDarkFractals = this.cloudBuilder.darkFractalCircles.filter(
      (c) => c.linkedCell == cell.id,
    );
    for (const fractal of linkedDarkFractals) {
      this.renderer.addCircleLayer({
        x: fractal.x,
        y: fractal.y,
        radius: fractal.radius,
        fill: this.renderer.colours.dark2,
        rightEdgeNoise: 2, // Plus or minus this many pixels
        leftEdgeNoise: 4,
        rightPadding: 0,
        leftPadding: 0,
        lineWidth: 1.4,
        specialType: "dark-fractal",
        waveAmplitude: 0.7,
        wavePeriod: 30,
      });
    }

    const linkedLightFractals = this.cloudBuilder.lightFractalCircles.filter(
      (c) => c.linkedCell == cell.id,
    );
    for (const fractal of linkedLightFractals) {
      this.renderer.addCircleLayer({
        x: fractal.x,
        y: fractal.y,
        radius: fractal.radius,
        fill: this.renderer.colours.mid,
        rightEdgeNoise: 4, // Plus or minus this many pixels
        leftEdgeNoise: 4,
        rightPadding: fractal.rightPadding,
        leftPadding: 0,
        specialType: "light-fractal",
        waveAmplitude: 0.7,
        wavePeriod: 30,
      });
    }
  }

  addFillCircleLayer(circle) {
    this.renderer.addCircleLayer({
      x: circle.x,
      y: circle.y,
      radius: circle.radius,
      fill: this.renderer.colours.dark,
      lineWidth: 1.3,
      rightEdgeNoise: 6,
      leftEdgeNoise: 6,
      leftPadding: 0,
      rightPadding: 0,
    });
  }

  addCloudInnerRightLayer(inner) {
    this.renderer.addRightAnglePolygonLayer({
      vertices: inner,
      fill: this.renderer.colours.dark,
      lineWidth: 1.3,
      rightEdgeNoise: 5,
      leftEdgeNoise: 0,
      leftPadding: 0,
      rightPadding: 0,
      // TODO: Top and bottom noise
    });
  }

  addCloudInnerLeftLayer(inner) {
    this.renderer.addRightAnglePolygonLayer({
      vertices: inner,
      fill: this.renderer.colours.dark,
      lineWidth: 1.3,
      rightEdgeNoise: 0,
      leftEdgeNoise: 5,
      leftPadding: 0,
      rightPadding: 0,
      // TODO: Top and bottom noise
    });
  }

  addCloudCellLayers(cells) {
    for (const cell of cells) {
      this.addCloudCellLayer(cell);
    }
  }

  addFillCircleLayers(circles) {
    for (const circle of circles) {
      this.addFillCircleLayer(circle);
    }
  }

  //----------------------------------------------------//

  renderCell(cell, showNumbers = false) {
    this.context.beginPath();
    this.context.arc(cell.x, cell.y, cell.radius, 0, 2 * Math.PI);
    this.context.fillStyle = "lightblue";
    this.context.fill();
    this.context.beginPath();
    this.context.arc(cell.x, cell.y, cell.radius, 1.5 * Math.PI, 0.5 * Math.PI);
    this.context.strokeStyle = "blue";
    this.context.lineWidth = 1;
    this.context.stroke();

    if (showNumbers) {
      this.context.save();
      this.context.fillStyle = "blue";
      this.context.font = `${Math.max(10, cell.radius * 0.5)}px sans-serif`;
      this.context.textAlign = "center";
      this.context.textBaseline = "middle";
      this.context.fillText(String(cell.id), cell.x, cell.y);
      this.context.restore();
    }
  }

  renderCells(cells) {
    for (const cell of cells) {
      this.renderCell(cell);
    }
  }

  renderPolygon(polygon) {
    if (!polygon || polygon.length === 0) return;

    this.context.beginPath();
    this.context.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < polygon.length; i++) {
      this.context.lineTo(polygon[i].x, polygon[i].y);
    }
    this.context.closePath();
    this.context.fillStyle = "rgba(190, 216, 230, 0.4)"; // Light blue with transparency
    this.context.fill();
    //this.context.strokeStyle = "blue";
    //this.context.lineWidth = 1;
    //this.context.stroke();
  }
}
