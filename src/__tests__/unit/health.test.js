describe('Health Check', () => {
  it('should be defined', () => {
    expect(true).toBe(true);
  });

  it('should have correct test environment', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });
});
