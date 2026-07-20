import {
  mat4,
  mat3,
  vec3,
} from "https://webgpufundamentals.org/3rdparty/wgpu-matrix.module.js";

// prettier-ignore
function createFVertices() {
  const positions = [
    // left column
     -50,  75,  15,
     -20,  75,  15,
     -50, -75,  15,
     -20, -75,  15,
 
    // top rung
     -20,  75,  15,
      50,  75,  15,
     -20,  45,  15,
      50,  45,  15,
 
    // middle rung
     -20,  15,  15,
      20,  15,  15,
     -20, -15,  15,
      20, -15,  15,
 
    // left column back
     -50,  75, -15,
     -20,  75, -15,
     -50, -75, -15,
     -20, -75, -15,
 
    // top rung back
     -20,  75, -15,
      50,  75, -15,
     -20,  45, -15,
      50,  45, -15,
 
    // middle rung back
     -20,  15, -15,
      20,  15, -15,
     -20, -15, -15,
      20, -15, -15,
  ];
 
  const indices = [
     0,  2,  1,    2,  3,  1,   // left column
     4,  6,  5,    6,  7,  5,   // top run
     8, 10,  9,   10, 11,  9,   // middle run
 
    12, 13, 14,   14, 13, 15,   // left column back
    16, 17, 18,   18, 17, 19,   // top run back
    20, 21, 22,   22, 21, 23,   // middle run back
 
     0,  5, 12,   12,  5, 17,   // top
     5,  7, 17,   17,  7, 19,   // top rung right
     6, 18,  7,   18, 19,  7,   // top rung bottom
     6,  8, 18,   18,  8, 20,   // between top and middle rung
     8,  9, 20,   20,  9, 21,   // middle rung top
     9, 11, 21,   21, 11, 23,   // middle rung right
    10, 22, 11,   22, 23, 11,   // middle rung bottom
    10,  3, 22,   22,  3, 15,   // stem right
     2, 14,  3,   14, 15,  3,   // bottom
     0, 12,  2,   12, 14,  2,   // left
  ];
 
  const normals = [
        0,   0,   1,  // left column front
        0,   0,   1,  // top rung front
        0,   0,   1,  // middle rung front
 
        0,   0,  -1,  // left column back
        0,   0,  -1,  // top rung back
        0,   0,  -1,  // middle rung back
 
        0,   1,   0,  // top
        1,   0,   0,  // top rung right
        0,  -1,   0,  // top rung bottom
        1,   0,   0,  // between top and middle rung
        0,   1,   0,  // middle rung top
        1,   0,   0,  // middle rung right
        0,  -1,   0,  // middle rung bottom
        1,   0,   0,  // stem right
        0,  -1,   0,  // bottom
       -1,   0,   0,  // left
  ];
 
  const numVertices = indices.length;
  const vertexData = new Float32Array(numVertices * 6); // xyz + normal
 
  for (let i = 0; i < indices.length; ++i) {
    const positionNdx = indices[i] * 3;
    const position = positions.slice(positionNdx, positionNdx + 3);
    vertexData.set(position, i * 6);
 
    const quadNdx = (i / 6 | 0) * 3;
    const normal = normals.slice(quadNdx, quadNdx + 3);
    vertexData.set(normal, i * 6 + 3);
  }
 
  return {
    vertexData,
    numVertices,
  };
}

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    console.error("WebGPU not supported");
    return;
  }

  const canvas = document.querySelector("canvas");
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "premultiplied",
  });

  const module = device.createShaderModule({
    label: "our hardcoded green triangle shaders",
    code: /* wgsl */ `
			struct Uniforms {
        normalMatrix: mat3x3f,
        worldViewProjection: mat4x4f,
        color: vec4f,
        lightDirection: vec3f,
			};

			struct Vertex {
				@location(0) position: vec4f,
        @location(1) normal: vec3f,
			};

			struct VSOutput {
				@builtin(position) position: vec4f,
        @location(0) normal: vec3f,
			};

			@group(0) @binding(0) var<uniform> uni: Uniforms;

			@vertex fn vs(vert: Vertex) -> VSOutput {
				var vsOut: VSOutput;
				vsOut.position = uni.worldViewProjection * vert.position;
        vsOut.normal = uni.normalMatrix * vert.normal;
				return vsOut;
			}

			@fragment fn fs(vsOut: VSOutput) -> @location(0) vec4f {
        let normal = normalize(vsOut.normal);
        let light = dot(normal, -uni.lightDirection);
        let color = uni.color.rgb * light;
        return vec4f(color, uni.color.a);
			}
		`,
  });

  const pipeline = device.createRenderPipeline({
    label: "just 2d position",
    layout: "auto",
    vertex: {
      entryPoint: "vs",
      module,
      buffers: [
        {
          arrayStride: (3 + 3) * Float32Array.BYTES_PER_ELEMENT,
          attributes: [
            { shaderLocation: 0, format: "float32x3", offset: 0 },
            { shaderLocation: 1, format: "float32x3", offset: 12 },
          ],
        },
      ],
    },
    fragment: {
      entryPoint: "fs",
      module,
      targets: [{ format }],
    },
    primitive: {
      cullMode: "back",
    },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: "less",
      format: "depth24plus",
    },
  });

  const { vertexData, numVertices } = createFVertices();

  const vertexBuffer = device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertexData);

  const uniformValues = new Float32Array(12 + 16 + 4 + 4);

  const uniformBuffer = device.createBuffer({
    size: uniformValues.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const kNormalMatrixOffset = 0;
  const kWorldViewProjectionOffset = 12;
  const kColorOffset = 28;
  const kLightDirectionOffset = 32;

  const normalMatrixValue = uniformValues.subarray(
    kNormalMatrixOffset,
    kNormalMatrixOffset + 12,
  );
  const worldViewProjectionValue = uniformValues.subarray(
    kWorldViewProjectionOffset,
    kWorldViewProjectionOffset + 16,
  );
  const colorValue = uniformValues.subarray(kColorOffset, kColorOffset + 4);
  const lightDirectionValue = uniformValues.subarray(
    kLightDirectionOffset,
    kLightDirectionOffset + 3,
  );

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: uniformBuffer }],
  });

  /** @type{GPURenderPassDescriptor} */
  const renderPassDesc = {
    label: "demo render pass descriptor",
    colorAttachments: [
      {
        //view: TODO
        loadOp: "clear",
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      //view: TODO
      depthClearValue: 1.0,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  };

  const radius = 200;
  const settings = {
    rotation: 0,
  };

  /** @type{GPUTexture} */
  let depthTexture;

  function render() {
    const canvasTexture = context.getCurrentTexture();
    renderPassDesc.colorAttachments[0].view = canvasTexture.createView();

    if (
      !depthTexture ||
      depthTexture.width !== canvasTexture.width ||
      depthTexture.height !== canvasTexture.height
    ) {
      if (depthTexture) {
        depthTexture.destroy();
      }
      depthTexture = device.createTexture({
        size: [canvasTexture.width, canvasTexture.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }

    renderPassDesc.depthStencilAttachment.view = depthTexture.createView();

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass(renderPassDesc);
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);

    const aspect = canvas.clientWidth / canvas.clientHeight;
    const projection = mat4.perspective(
      (60 * Math.PI) / 180,
      aspect,
      1, // zNear
      2000, // zFar
    );
    const eye = [100, 150, 200];
    const target = [0, 35, 0];
    const up = [0, 1, 0];
    const viewMatrix = mat4.lookAt(eye, target, up);
    const viewProjectionMatrix = mat4.multiply(projection, viewMatrix);

    const world = mat4.rotationY((settings.rotation * Math.PI) / 180);
    mat4.multiply(viewProjectionMatrix, world, worldViewProjectionValue);
    mat3.fromMat4(mat4.transpose(mat4.inverse(world)), normalMatrixValue);

    colorValue.set([0.2, 1, 0.2, 1]);
    lightDirectionValue.set(vec3.normalize([-0.5, -0.7, -1]));

    device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    pass.setBindGroup(0, bindGroup);
    pass.draw(numVertices);

    pass.end();

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const canvas = entry.target;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      canvas.width = Math.max(
        1,
        Math.min(width, device.limits.maxTextureDimension2D),
      );
      canvas.height = Math.max(
        1,
        Math.min(height, device.limits.maxTextureDimension2D),
      );
    }
    render();
  });

  observer.observe(canvas);

  const gui = new dat.GUI({});
  gui.add(settings, "rotation", -360, 360).onChange(render);
}
main();
