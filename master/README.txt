cd master
pip install pyinstaller
pyinstaller --onefile app.py

cd master
pyinstaller master.spec

#check port
netstat -ano|findstr 5555
TCP    0.0.0.0:5555           0.0.0.0:0              LISTENING       31484

#allow zerotier accesss port 5555
New-NetFirewallRule -DisplayName "Allow Flask 5555 (ZeroTier)" -Direction Inbound -Protocol TCP -LocalPort 5555 -Action Allow
Name                          : {dad51a03-7ebd-4c53-ad62-21ae37d2049a}
DisplayName                   : Allow Flask 5555 (ZeroTier)
Description                   :
DisplayGroup                  :
Group                         :
Enabled                       : True
Profile                       : Any
Platform                      : {}
Direction                     : Inbound
Action                        : Allow
EdgeTraversalPolicy           : Block
LooseSourceMapping            : False
LocalOnlyMapping              : False
Owner                         :
PrimaryStatus                 : OK
Status                        : 已从存储区成功分析规则。 (65536)
EnforcementStatus             : NotApplicable
PolicyStoreSource             : PersistentStore
PolicyStoreSourceType         : Local
RemoteDynamicKeywordAddresses :
PolicyAppId                   :
