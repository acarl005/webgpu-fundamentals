async function main() {
	const adapter = await navigator.gpu?.requestAdapter();
	const device = await adapter?.requestDevice();
	if (!device) {
		console.error("WebGPU not supported");
		return;
	}

	const module = device.createShaderModule({
		label: "my doubling compute module",
		code: /* wgsl */`
			@group(0) @binding(0) var<storage, read_write> data: array<f32>;

			@compute @workgroup_size(1) fn computeSomething(
				@builtin(global_invocation_id) id: vec3u
			) {
				let i = id.x;
				data[i] = data[i] * 2.0;
			}
		`
	});

	const pipeline = device.createComputePipeline({
		label: "my doubling compute pipeline",
		layout: "auto",
		compute: {
			entryPoint: "computeSomething",
			module,
		},
	});

	const input = new Float32Array([1, 3, 5]);
	const workBuffer = device.createBuffer({
		label: "my work buffer",
		size: input.byteLength,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
	})
	device.queue.writeBuffer(workBuffer, 0, input);

	const resultBuffer = device.createBuffer({
		label: "my result buffer",
		size: input.byteLength,
		usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
	});

	const bindGroup = device.createBindGroup({
		label: "bind group for work buffer",
		layout: pipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: workBuffer }
		]
	});

	const encoder = device.createCommandEncoder({
		label: "my doubling encoder",
	});

	const pass = encoder.beginComputePass({
		label: "my doubling compute pass"
	});

	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup);
	pass.dispatchWorkgroups(input.length);
	pass.end();

	encoder.copyBufferToBuffer(workBuffer, 0, resultBuffer, 0, resultBuffer.size);

	const commandBuffer = encoder.finish();
	device.queue.submit([commandBuffer]);

	await resultBuffer.mapAsync(GPUMapMode.READ);
	const result = new Float32Array(resultBuffer.getMappedRange());
	console.log("input", JSON.stringify(input));
	console.log("result", JSON.stringify(result));
	resultBuffer.unmap();
}
main()
