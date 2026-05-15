export async function healthCheck(req:any, res:any){
    res.status(200).json({ message: 'Server working fine' });
}